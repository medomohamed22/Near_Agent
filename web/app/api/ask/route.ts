import { z } from "zod";
import { getRecords } from "@/lib/chain";
import { CONTRACT_ID } from "@/lib/config";
import type { AskResponse, Extraction } from "@/lib/types";
import { aiConfigured, askRecords, offlineAnswer, type RecordContext } from "@/lib/server/ai";
import { allow, tooLarge, tooMany } from "@/lib/server/ratelimit";
import { supabase } from "@/lib/server/supabase";

export const maxDuration = 60;

const Body = z.object({
  vehicleId: z.number().int().min(1),
  question: z.string().trim().min(2).max(300),
  lang: z.enum(["ar", "en"]),
});

/** Answers a buyer's question from the passport's on-chain records only. */
export async function POST(request: Request) {
  const big = tooLarge(request, 5_000);
  if (big) return big;
  if (!(await allow(request, "ask"))) return tooMany();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Malformed request." }, { status: 400 });
  const { vehicleId, question, lang } = parsed.data;

  const records = await getRecords(vehicleId);
  const fields = new Map<string, Extraction>();
  const db = await supabase();
  if (db) {
    const rows = await db.from("carpass_documents").select("sha256, extraction").eq("contract_id", CONTRACT_ID).eq("vehicle_id", vehicleId);
    for (const r of rows.data ?? []) if (r.extraction) fields.set(r.sha256, r.extraction as Extraction);
  }
  // Stored fields are used only while they agree with the contract's own record of the document.
  const context: RecordContext[] = records.map((record) => {
    const x = fields.get(record.doc_hash) ?? null;
    const agrees = !!x && x.kind === record.kind && x.event_date === record.event_date && (x.odometer_km ?? null) === (record.odometer_km ?? null);
    return { record, extraction: agrees ? x : null };
  });

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
