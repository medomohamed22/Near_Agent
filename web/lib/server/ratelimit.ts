import "server-only";

const hits = new Map<string, number[]>();

/**
 * Best-effort limiter kept in this server instance's memory. It slows a
 * single abusive client; it is not a guarantee across instances.
 */
export function allow(request: Request, bucket: string, max: number, windowMs: number): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

export const tooMany = () =>
  Response.json({ ok: false, error: "Too many requests. Please wait a minute and try again." }, { status: 429 });
