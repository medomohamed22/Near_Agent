import { z } from "zod";
import { getRecords } from "@/lib/chain";
import { isSha256 } from "@/lib/hash";
import { RECORD_KINDS } from "@/lib/types";
import { allow, tooMany } from "@/lib/server/ratelimit";
import { BUCKET, supabase } from "@/lib/server/supabase";
import { readUpload } from "@/lib/server/upload";

export const dynamic = "force-dynamic";

const ExtractionBody = z.object({
  kind: z.enum(RECORD_KINDS),
  event_date: z.number().int().nullable(),
  odometer_km: z.number().int().min(0).max(2_000_000).nullable(),
  provider_name: z.string().max(120).nullable(),
  summary: z.string().max(400),
  evidence: z.record(z.string(), z.string().max(200)),
  warnings: z.array(z.string().max(200)).max(5),
});

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Stores a document copy and its reviewed fields. A stored file only ever
 * becomes visible once its hash is registered on chain for that passport, so
 * the contract, not this endpoint, decides what belongs to a car.
 */
export async function POST(request: Request) {
  if (!allow(request, "upload", 20, 10 * 60_000)) return tooMany();
  const db = await supabase();
  if (!db) return Response.json({ error: "Document storage is not configured on this deployment." }, { status: 503 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Malformed request." }, { status: 400 });
  const upload = await readUpload(form);
  if (typeof upload === "string") return Response.json({ error: upload }, { status: 400 });
  const vehicleId = Number(form.get("vehicleId"));
  if (!Number.isSafeInteger(vehicleId) || vehicleId < 1) return Response.json({ error: "Unknown passport." }, { status: 400 });
  let raw: unknown = null;
  try { raw = JSON.parse(String(form.get("extraction") ?? "null")); } catch { /* handled by the schema check below */ }
  const extraction = ExtractionBody.safeParse(raw);
  if (!extraction.success) return Response.json({ error: "The reviewed fields are malformed." }, { status: 400 });

  const path = `${vehicleId}/${upload.sha256}.${EXT[upload.mime]}`;
  const stored = await db.storage.from(BUCKET).upload(path, upload.bytes, { contentType: upload.mime, upsert: true });
  if (stored.error) {
    console.error("storage upload failed", stored.error);
    return Response.json({ error: "The document could not be stored." }, { status: 502 });
  }
  const row = await db.from("documents").upsert({
    vehicle_id: vehicleId, sha256: upload.sha256, storage_path: path, mime: upload.mime,
    size_bytes: upload.bytes.length, extraction: extraction.data,
  });
  if (row.error) {
    console.error("documents upsert failed", row.error);
    return Response.json({ error: "The document could not be stored." }, { status: 502 });
  }
  return Response.json({ sha256: upload.sha256 });
}

/**
 * ?vehicleId=1            -> reviewed fields for every on-chain record of the passport
 * ?vehicleId=1&sha256=... -> the document file itself
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const vehicleId = Number(url.searchParams.get("vehicleId"));
  if (!Number.isSafeInteger(vehicleId) || vehicleId < 1) return Response.json({ error: "Unknown passport." }, { status: 400 });
  const db = await supabase();
  if (!db) return Response.json({ error: "Document storage is not configured on this deployment." }, { status: 503 });

  const onChain = new Set((await getRecords(vehicleId)).map((r) => r.doc_hash));
  const sha256 = url.searchParams.get("sha256");

  if (!sha256) {
    const rows = await db.from("documents").select("sha256, extraction").eq("vehicle_id", vehicleId);
    if (rows.error) return Response.json({ error: "The documents could not be read." }, { status: 502 });
    const documents = Object.fromEntries(rows.data.filter((r) => onChain.has(r.sha256)).map((r) => [r.sha256, r.extraction]));
    return Response.json({ documents });
  }

  if (!isSha256(sha256) || !onChain.has(sha256)) return Response.json({ error: "No such document on this passport." }, { status: 404 });
  const row = await db.from("documents").select("storage_path, mime").eq("vehicle_id", vehicleId).eq("sha256", sha256).maybeSingle();
  if (row.error || !row.data) return Response.json({ error: "The file for this record was not stored." }, { status: 404 });
  const file = await db.storage.from(BUCKET).download(row.data.storage_path);
  if (file.error) return Response.json({ error: "The file could not be read." }, { status: 502 });
  return new Response(file.data, {
    headers: {
      "content-type": row.data.mime,
      "content-disposition": "inline",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
