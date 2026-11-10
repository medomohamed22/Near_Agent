/** SHA-256 of raw bytes, lowercase hex. Works in the browser and on the server. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const isSha256 = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/** The VIN never leaves the browser; only this salted hash goes on chain. */
export const vinHash = (vin: string) => sha256Hex(`carpass:vin:${vin.trim().toUpperCase()}`);
