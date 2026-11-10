import samples from "@/lib/samples.json";
import type { ExtractResponse, Extraction, RecordKind } from "@/lib/types";
import { aiConfigured, extractDocument } from "@/lib/server/ai";
import { allow, tooMany } from "@/lib/server/ratelimit";
import { readUpload } from "@/lib/server/upload";

export const maxDuration = 60;

const EMPTY: Extraction = {
  kind: "Maintenance", event_date: null, odometer_km: null, provider_name: null, summary: "", evidence: {}, warnings: [],
};

function fixtureFor(sha256: string, lang: "ar" | "en"): Extraction | null {
  const s = samples.find((x) => x.sha256 === sha256);
  if (!s) return null;
  return { ...s.extraction, kind: s.extraction.kind as RecordKind, summary: s.extraction.summary[lang] };
}

/** Reads a document image and proposes its fields. The result is a draft for the uploader to review. */
export async function POST(request: Request) {
  if (!allow(request, "extract", 12, 10 * 60_000)) return tooMany();
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Malformed request." }, { status: 400 });
  const upload = await readUpload(form);
  if (typeof upload === "string") return Response.json({ error: upload }, { status: 400 });
  const lang = form.get("lang") === "ar" ? "ar" : "en";

  let failure = "";
  if (aiConfigured()) {
    try {
      const extraction = await extractDocument(upload.bytes, upload.mime, lang);
      return Response.json({ sha256: upload.sha256, extraction, source: "live" } satisfies ExtractResponse);
    } catch (e) {
      console.error("extract failed", e);
      failure = "The AI service did not answer.";
    }
  } else {
    failure = "The AI service is not configured on this deployment.";
  }

  // Fallbacks are labelled as such; they are never presented as a live reading.
  const fixture = fixtureFor(upload.sha256, lang);
  const body: ExtractResponse = fixture
    ? { sha256: upload.sha256, extraction: fixture, source: "fixture", note: failure }
    : { sha256: upload.sha256, extraction: EMPTY, source: "manual", note: failure };
  return Response.json(body);
}
