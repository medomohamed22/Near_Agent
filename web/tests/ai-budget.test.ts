import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../lib/server/supabase", () => ({ supabase: async () => null }));
process.env.AI_DAILY_PER_IP = "2";
process.env.AI_DAILY_TOTAL = "3";
const { spendAi } = await import("../lib/server/ai-budget");

const from = (ip: string) => new Request("https://carpass.test/api/ask", { headers: { "x-vercel-forwarded-for": ip } });

describe("daily AI budget", () => {
  it("caps each client per day, then the whole site", async () => {
    expect(await spendAi(from("1.1.1.1"))).toEqual({ ok: true });
    expect(await spendAi(from("1.1.1.1"))).toEqual({ ok: true });
    // Over the client limit: refused, and the site budget is not touched.
    expect(await spendAi(from("1.1.1.1"))).toEqual({ ok: false, reason: "client" });
    expect(await spendAi(from("1.1.1.1"))).toEqual({ ok: false, reason: "client" });
    expect(await spendAi(from("2.2.2.2"))).toEqual({ ok: true });
    // Three calls served today: the site is full for everyone.
    expect(await spendAi(from("3.3.3.3"))).toEqual({ ok: false, reason: "site" });
  });
});
