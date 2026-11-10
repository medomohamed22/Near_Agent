import "server-only";
import { supabase } from "./supabase";

const memory = new Map<string, number[]>();

/** In-memory fallback for one server instance, used only when the shared counter is unreachable. */
function allowInMemory(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (memory.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length < max) recent.push(now);
  memory.set(key, recent);
  if (memory.size > 5000) {
    // Drop the oldest half rather than everything, so active limits survive.
    for (const k of [...memory.keys()].slice(0, 2500)) memory.delete(k);
  }
  return recent.length <= max && recent[recent.length - 1] === now;
}

/** The caller's address as the platform reports it; a client-supplied X-Forwarded-For is the last resort. */
export function clientKey(request: Request): string {
  const h = request.headers;
  return (
    h.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    "local"
  );
}

type Limit = { perClient: number; total: number };

/** Requests allowed per 10 minutes for one client, and per hour for the whole service. */
export const LIMITS = {
  relay: { perClient: 30, total: 400 },
  extract: { perClient: 12, total: 150 },
  upload: { perClient: 20, total: 300 },
  ask: { perClient: 20, total: 300 },
} satisfies Record<string, Limit>;

/**
 * Counts this request against the caller's quota and the service-wide budget.
 * Counters live in Postgres, so every server instance shares them.
 */
export async function allow(request: Request, bucket: keyof typeof LIMITS): Promise<boolean> {
  const { perClient, total } = LIMITS[bucket];
  const client = clientKey(request);
  const db = await supabase();
  if (db) {
    const [mine, all] = await Promise.all([
      db.rpc("carpass_hit", { p_bucket: bucket, p_key: client, p_window_sec: 600, p_max: perClient }),
      db.rpc("carpass_hit", { p_bucket: bucket, p_key: "*", p_window_sec: 3600, p_max: total }),
    ]);
    if (!mine.error && !all.error) return mine.data === true && all.data === true;
    console.error("shared rate limit unavailable", mine.error?.message || all.error?.message);
  }
  return allowInMemory(`${bucket}:${client}`, perClient, 600_000) && allowInMemory(`${bucket}:*`, total, 3_600_000);
}

export const tooMany = () =>
  Response.json({ ok: false, error: "Too many requests. Please wait a few minutes and try again." }, { status: 429 });

/** Rejects an oversized body from its declared length, before any of it is read. */
export function tooLarge(request: Request, maxBytes: number): Response | null {
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) {
    return Response.json({ ok: false, error: "The request must declare its length." }, { status: 411 });
  }
  if (declared > maxBytes) return Response.json({ ok: false, error: "The request is too large." }, { status: 413 });
  return null;
}
