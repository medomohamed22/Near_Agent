import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getRecords, getVehicle } from "@/lib/chain";
import { CONTRACT_ID } from "@/lib/config";
import { isSha256 } from "@/lib/hash";
import { RECORD_KINDS, type CarRecord, type Extraction } from "@/lib/types";
import { allow, tooLarge, tooMany } from "@/lib/server/ratelimit";
import { BUCKET, supabase } from "@/lib/server/supabase";
import { readUpload } from "@/lib/server/upload";

export const dynamic = "force-dynamic";

const ExtractionBody = z.object({
  kind: z.enum(RECORD_KINDS),
  event_date: z.number().int().nullable(),
  odometer_km: z.number().int().min(0).max(2_000_000).nullable(),
  provider_name: z.string().max(120).nullable(),
  summary: z.string().max(400),
  summary_i18n: z.object({ en: z.string().max(400), ar: z.string().max(400) }).partial().optional(),
  evidence: z.record(z.string(), z.string().max(200)),
  warnings: z.array(z.string().max(200)).max(5),
});

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PENDING_TTL_MS = 60 * 60_000;
const fail = (status: number, error: string) => Response.json({ error }, { status });

type Row = { vehicle_id: number; sha256: string; storage_path: string };

/** Marks rows whose hash is now on chain as published; they are frozen from then on. */
async function publish(db: SupabaseClient, vehicleId: number, hashes: string[]) {
  if (hashes.length === 0) return;
  const { error } = await db.from("carpass_documents").update({ published: true })
    .eq("contract_id", CONTRACT_ID).eq("vehicle_id", vehicleId).in("sha256", hashes).eq("published", false);
  if (error) console.error("publish failed", error.message);
}

/**
 * Removes uploads that were never registered on chain within an hour, for
 * example when the person rejected the transaction in their wallet.
 */
async function sweepPending(db: SupabaseClient) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  const { data, error } = await db.from("carpass_documents").select("vehicle_id, sha256, storage_path")
    .eq("contract_id", CONTRACT_ID).eq("published", false).lt("created_at", cutoff).limit(20);
  if (error || !data?.length) return;
  const byVehicle = new Map<number, Row[]>();
  for (const row of data as Row[]) byVehicle.set(row.vehicle_id, [...(byVehicle.get(row.vehicle_id) ?? []), row]);
  for (const [vehicleId, rows] of byVehicle) {
    const onChain = new Set((await getRecords(vehicleId)).map((r) => r.doc_hash));
    await publish(db, vehicleId, rows.filter((r) => onChain.has(r.sha256)).map((r) => r.sha256));
    const stale = rows.filter((r) => !onChain.has(r.sha256));
    if (stale.length === 0) continue;
    await db.storage.from(BUCKET).remove(stale.map((r) => r.storage_path));
    await db.from("carpass_documents").delete().eq("contract_id", CONTRACT_ID).eq("vehicle_id", vehicleId).in("sha256", stale.map((r) => r.sha256)).eq("published", false);
  }
}

/** The stored fields are shown only while they agree with what the contract recorded for the same document. */
function agrees(x: Extraction | null, r: CarRecord): x is Extraction {
  return !!x && x.kind === r.kind && x.event_date === r.event_date && (x.odometer_km ?? null) === (r.odometer_km ?? null);
}

/**
 * Stores a pending copy of a document with its reviewed fields.
 *
 * The contract, not this endpoint, decides what belongs to a car: a copy is
 * only ever served once its hash is registered on chain for that passport by
 * the holder or an approved workshop. Until then it is a pending upload that
 * expires after an hour. Once the hash is on chain the copy and its fields
 * are frozen and cannot be replaced.
 */
export async function POST(request: Request) {
  const big = tooLarge(request, 6_000_000);
  if (big) return big;
  if (!(await allow(request, "upload"))) return tooMany();
  const db = await supabase();
  if (!db) return fail(503, "Document storage is not configured on this deployment.");
  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Malformed request.");
  const upload = await readUpload(form);
  if (typeof upload === "string") return fail(400, upload);
  const vehicleId = Number(form.get("vehicleId"));
  if (!Number.isSafeInteger(vehicleId) || vehicleId < 1) return fail(400, "Unknown passport.");
  let raw: unknown = null;
  try { raw = JSON.parse(String(form.get("extraction") ?? "null")); } catch { /* handled by the schema check below */ }
  const extraction = ExtractionBody.safeParse(raw);
  if (!extraction.success) return fail(400, "The reviewed fields are malformed.");

  if (!(await getVehicle(vehicleId))) return fail(404, "No such passport.");
  const onChain = (await getRecords(vehicleId)).some((r) => r.doc_hash === upload.sha256);
  if (onChain) return fail(409, "This document is already registered on this passport and cannot be replaced.");

  sweepPending(db).catch((e) => console.error("sweep failed", e));

  const path = `${CONTRACT_ID}/${vehicleId}/${upload.sha256}.${EXT[upload.mime]}`;
  const stored = await db.storage.from(BUCKET).upload(path, upload.bytes, { contentType: upload.mime, upsert: true });
  if (stored.error) {
    console.error("storage upload failed", stored.error);
    return fail(502, "The document could not be stored.");
  }
  // Replaces only a pending row. A published row is never matched by this
  // filter, so a registered document's fields cannot be overwritten.
  const pending = { storage_path: path, mime: upload.mime, size_bytes: upload.bytes.length, extraction: extraction.data, created_at: new Date().toISOString() };
  const updated = await db.from("carpass_documents").update(pending)
    .eq("contract_id", CONTRACT_ID).eq("vehicle_id", vehicleId).eq("sha256", upload.sha256).eq("published", false).select("sha256");
  if (updated.error) {
    console.error("documents update failed", updated.error);
    return fail(502, "The document could not be stored.");
  }
  if (updated.data.length === 0) {
    const inserted = await db.from("carpass_documents").insert({ contract_id: CONTRACT_ID, vehicle_id: vehicleId, sha256: upload.sha256, ...pending });
    if (inserted.error) {
      // A unique violation here means a published row exists.
      const frozen = inserted.error.code === "23505";
      if (!frozen) console.error("documents insert failed", inserted.error);
      return fail(frozen ? 409 : 502, frozen ? "This document is already registered on this passport and cannot be replaced." : "The document could not be stored.");
    }
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
  if (!Number.isSafeInteger(vehicleId) || vehicleId < 1) return fail(400, "Unknown passport.");
  const db = await supabase();
  if (!db) return fail(503, "Document storage is not configured on this deployment.");

  const records = await getRecords(vehicleId);
  const byHash = new Map(records.map((r) => [r.doc_hash, r]));
  const sha256 = url.searchParams.get("sha256");

  if (!sha256) {
    const rows = await db.from("carpass_documents").select("sha256, extraction, published").eq("contract_id", CONTRACT_ID).eq("vehicle_id", vehicleId);
    if (rows.error) return fail(502, "The documents could not be read.");
    const live = rows.data.filter((r) => byHash.has(r.sha256));
    await publish(db, vehicleId, live.filter((r) => !r.published).map((r) => r.sha256));
    const documents = Object.fromEntries(
      live.filter((r) => agrees(r.extraction as Extraction | null, byHash.get(r.sha256)!)).map((r) => [r.sha256, r.extraction]),
    );
    return Response.json({ documents });
  }

  if (!isSha256(sha256) || !byHash.has(sha256)) return fail(404, "No such document on this passport.");
  const row = await db.from("carpass_documents").select("storage_path, mime").eq("contract_id", CONTRACT_ID).eq("vehicle_id", vehicleId).eq("sha256", sha256).maybeSingle();
  if (row.error || !row.data) return fail(404, "The file for this record was not stored.");
  const file = await db.storage.from(BUCKET).download(row.data.storage_path);
  if (file.error) return fail(502, "The file could not be read.");
  return new Response(file.data, {
    headers: {
      "content-type": row.data.mime,
      "content-disposition": "inline",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
