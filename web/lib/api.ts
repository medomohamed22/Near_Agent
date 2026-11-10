import type { Role } from "./config";
import type { AskResponse, ExtractResponse, Extraction, RelayResponse } from "./types";

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error || `Request failed (${res.status})`;
}

/** Signs one contract call as a guest account. Throws with the contract's own message on failure. */
export async function relayCall(role: Role, method: string, args: Record<string, unknown>) {
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, method, args }),
  });
  const body = (await res.json().catch(() => null)) as RelayResponse | null;
  if (!body || !body.ok) throw new Error(body && !body.ok ? body.error : `Request failed (${res.status})`);
  return body;
}

export async function extractFile(file: File, lang: string): Promise<ExtractResponse> {
  const form = new FormData();
  form.set("file", file);
  form.set("lang", lang);
  const res = await fetch("/api/extract", { method: "POST", body: form });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function storeDocument(file: File, vehicleId: number, extraction: Extraction): Promise<void> {
  const form = new FormData();
  form.set("file", file);
  form.set("vehicleId", String(vehicleId));
  form.set("extraction", JSON.stringify(extraction));
  const res = await fetch("/api/documents", { method: "POST", body: form });
  if (!res.ok) throw new Error(await readError(res));
}

export async function fetchDocuments(vehicleId: number): Promise<Record<string, Extraction>> {
  const res = await fetch(`/api/documents?vehicleId=${vehicleId}`, { cache: "no-store" });
  if (!res.ok) return {};
  return (await res.json()).documents ?? {};
}

export const documentUrl = (vehicleId: number, sha256: string) => `/api/documents?vehicleId=${vehicleId}&sha256=${sha256}`;

export async function askQuestion(vehicleId: number, question: string, lang: string): Promise<AskResponse> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vehicleId, question, lang }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
