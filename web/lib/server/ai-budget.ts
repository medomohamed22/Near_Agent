import "server-only";
import { clientKey } from "./ratelimit";
import { supabase } from "./supabase";

/**
 * Daily caps on paid AI calls, so a single visitor (or a flood of them) cannot
 * use up the AI credit. Answers served from the cache do not count.
 *
 *   AI_DAILY_PER_IP  calls per client address per UTC day (default 20)
 *   AI_DAILY_TOTAL   calls for the whole site per UTC day (default 250)
 */
const PER_IP = Number(process.env.AI_DAILY_PER_IP) || 20;
const TOTAL = Number(process.env.AI_DAILY_TOTAL) || 250;
const DAY = 86_400;

export type Allowance = { ok: true } | { ok: false; reason: "client" | "site" };

const memory = new Map<string, number>();
const today = () => new Date().toISOString().slice(0, 10);

/** Counts one AI call against the caller's and the site's daily budget. */
export async function spendAi(request: Request): Promise<Allowance> {
  const ip = clientKey(request);
  const db = await supabase();
  if (db) {
    // The caller's own counter is checked first, so someone already over their
    // limit cannot keep eating into the site's budget.
    const mine = await db.rpc("carpass_hit", { p_bucket: "ai-day", p_key: ip, p_window_sec: DAY, p_max: PER_IP });
    if (!mine.error) {
      if (mine.data !== true) return { ok: false, reason: "client" };
      const site = await db.rpc("carpass_hit", { p_bucket: "ai-day", p_key: "*", p_window_sec: DAY, p_max: TOTAL });
      if (!site.error) return site.data === true ? { ok: true } : { ok: false, reason: "site" };
    }
    console.error("AI budget counter unavailable", mine.error?.message);
  }
  // Without the shared counter, fall back to this server instance's memory.
  const day = today();
  const bump = (k: string) => { const n = (memory.get(k) ?? 0) + 1; memory.set(k, n); return n; };
  if (memory.size > 5000) memory.clear();
  if (bump(`${day}:${ip}`) > PER_IP) return { ok: false, reason: "client" };
  return bump(`${day}:*`) > TOTAL ? { ok: false, reason: "site" } : { ok: true };
}

export const budgetNote = (reason: "client" | "site") =>
  reason === "client"
    ? `Daily AI limit reached for your connection (${PER_IP} AI calls a day). Try again tomorrow.`
    : `The site's daily AI budget is used up (${TOTAL} AI calls a day). Try again tomorrow.`;

export const aiLimits = () => ({ per_client_per_day: PER_IP, site_per_day: TOTAL });

// ---- cache ----

type Kind = "extract" | "ask";

export async function cached<T>(kind: Kind, key: string, lang: string): Promise<T | null> {
  const db = await supabase();
  if (!db) return null;
  const { data } = await db.from("carpass_ai_cache").select("value").eq("kind", kind).eq("key", key).eq("lang", lang).maybeSingle();
  return (data?.value as T) ?? null;
}

export async function remember(kind: Kind, key: string, lang: string, value: unknown): Promise<void> {
  const db = await supabase();
  if (!db) return;
  const { error } = await db.from("carpass_ai_cache").upsert({ kind, key, lang, value });
  if (error) console.error("AI cache write failed", error.message);
}
