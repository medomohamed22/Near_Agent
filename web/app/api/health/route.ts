import { CONTRACT_ID, DEMO_ACCOUNTS, NETWORK, type Role } from "@/lib/config";
import { formatNear, getBalance, getConfig } from "@/lib/chain";
import { aiConfigured, aiModel } from "@/lib/server/ai";
import { aiLimits } from "@/lib/server/ai-budget";
import { configuredRoles } from "@/lib/server/near";
import { storageConfigured } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** What is live and what is on fallback. Never returns a secret. */
export async function GET() {
  const roles = configuredRoles();
  const [chain, balances] = await Promise.all([
    getConfig().then((c) => ({ ok: true as const, vehicles: c.vehicle_count, sales: c.sale_count, timeout_sec: c.timeout_sec }))
      .catch((e: Error) => ({ ok: false as const, error: e.message })),
    Promise.all(
      (Object.keys(DEMO_ACCOUNTS) as Role[]).map(async (r) =>
        [r, await getBalance(DEMO_ACCOUNTS[r]).then(formatNear).catch(() => null)] as const,
      ),
    ).then(Object.fromEntries),
  ]);
  return Response.json({
    network: NETWORK,
    contract: CONTRACT_ID,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    chain,
    guest: { ready: roles.length === 4, roles, balances_near: balances },
    ai: { live: aiConfigured(), model: aiModel(), limits: aiLimits() },
    storage: { live: storageConfigured() },
  });
}
