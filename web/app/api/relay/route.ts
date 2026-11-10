import { z } from "zod";
import { ROLES } from "@/lib/config";
import { relay, RelayError } from "@/lib/server/near";
import { allow, tooMany } from "@/lib/server/ratelimit";

export const maxDuration = 60;

const Body = z.object({
  role: z.enum(ROLES),
  method: z.string().regex(/^[a-z_]{3,40}$/),
  args: z.record(z.string(), z.unknown()).default({}),
});

/** Guest mode: signs one allowed contract call with a demo testnet account. */
export async function POST(request: Request) {
  if (!allow(request, "relay", 30, 10 * 60_000)) return tooMany();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Malformed request." }, { status: 400 });
  try {
    const { txHash, result } = await relay(parsed.data.role, parsed.data.method, parsed.data.args);
    return Response.json({ ok: true, txHash, result });
  } catch (e) {
    const known = e instanceof RelayError;
    if (!known) console.error("relay failed", e);
    return Response.json(
      { ok: false, error: known ? e.message : "The transaction could not be sent. Nothing was recorded." },
      { status: known ? 400 : 502 },
    );
  }
}
