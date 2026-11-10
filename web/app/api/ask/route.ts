import { z } from "zod";
import { getRecords } from "@/lib/chain";
import type { AskResponse, Extraction } from "@/lib/types";
import { aiConfigured, askRecords, offlineAnswer, type RecordContext } from "@/lib/server/ai";
import { allow, tooMany } from "@/lib/server/ratelimit";
import { supabase } from "@/lib/server/supabase";

export const maxDuration = 60;

const Body = z.object({
  vehicleId: z.number().int().min(1),
  question: z.string().trim().min(2).max(300),
  lang: z.enum(["ar", "en"]),
});

/** Answers a buyer's question from the passport's on-chain records only. */
export async function POST(request: Request) {
  if (!allow(request, "ask", 20, 10 * 60_000)) return tooMany();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Malformed request." }, { status: 400 });
  const { vehicleId, question, lang } = parsed.data;

  const records = await getRecords(vehicleId);
  const fields = new Map<string, Extraction>();
  const db = await supabase();
  if (db) {
    const rows = await db.from("documents").select("sha256, extraction").eq("vehicle_id", vehicleId);
    for (const r of rows.data ?? []) if (r.extraction) fields.set(r.sha256, r.extraction as Extraction);
  }
  const context: RecordContext[] = records.map((record) => ({ record, extraction: fields.get(record.doc_hash) ?? null }));

  let body: AskResponse;
  if (aiConfigured()) {
    try {
      body = await askRecords(question, context, lang);
    } catch (e) {
      console.error("ask failed", e);
      body = offlineAnswer(context, lang);
    }
  } else {
    body = offlineAnswer(context, lang);
  }
  return Response.json(body);
}
