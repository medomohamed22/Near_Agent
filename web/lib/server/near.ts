import "server-only";
import { connect, keyStores, KeyPair, type Account } from "near-api-js";
import { CONTRACT_ID, DEMO_ACCOUNTS, LISTING_FEE_NEAR, NETWORK, RPC_URL, VEHICLE_DEPOSIT_NEAR, inDemoScope, type Role } from "../config";
import { getBalance, getSale, getVehicle, parseNear } from "../chain";

const KEY_ENV: Record<Role, string> = {
  seller: "DEMO_SELLER_KEY",
  buyer: "DEMO_BUYER_KEY",
  workshop: "DEMO_WORKSHOP_KEY",
  reviewer: "DEMO_ADMIN_KEY",
};

/** What each guest role may call. Anything else is refused before signing. */
const USER_METHODS = [
  "create_vehicle", "add_record", "list_for_sale", "fund_sale", "mark_handed_over",
  "confirm_receipt", "cancel_sale", "claim_timeout", "open_dispute", "withdraw_owed",
];
const ALLOWED: Record<Role, string[]> = {
  seller: USER_METHODS,
  buyer: USER_METHODS,
  workshop: ["add_record", "attest_record"],
  reviewer: ["resolve_dispute"],
};

/** Guests cannot list above this, so the demo accounts never run dry on one sale. */
const MAX_GUEST_PRICE = BigInt(parseNear("3"));
const VEHICLE_DEPOSIT = BigInt(parseNear(VEHICLE_DEPOSIT_NEAR));
const LISTING_FEE = BigInt(parseNear(LISTING_FEE_NEAR));
const OUT_OF_SCOPE = "Guest accounts can only act on demo passports and demo sales. Connect a wallet to act on this one.";
const GAS = BigInt("60000000000000");
const RESERVE = BigInt(parseNear("0.5"));

export class RelayError extends Error {}

export const configuredRoles = () => (Object.keys(KEY_ENV) as Role[]).filter((r) => !!process.env[KEY_ENV[r]]);

let nearPromise: ReturnType<typeof connect> | null = null;
function near() {
  nearPromise ??= (async () => {
    const keyStore = new keyStores.InMemoryKeyStore();
    for (const role of configuredRoles()) {
      await keyStore.setKey(NETWORK, DEMO_ACCOUNTS[role], KeyPair.fromString(process.env[KEY_ENV[role]] as never));
    }
    return connect({ networkId: NETWORK, nodeUrl: RPC_URL, keyStore });
  })();
  return nearPromise;
}

async function account(role: Role): Promise<Account> {
  if (!process.env[KEY_ENV[role]]) throw new RelayError(`Guest mode is not configured for the ${role} account.`);
  return (await near()).account(DEMO_ACCOUNTS[role]);
}

/** Moves testnet NEAR between the demo accounts so the payer can cover `needed`. */
async function ensureFunds(role: Role, needed: bigint) {
  const want = needed + RESERVE;
  if ((await getBalance(DEMO_ACCOUNTS[role])) >= want) return;
  const others = configuredRoles().filter((r) => r !== role);
  const balances = await Promise.all(others.map(async (r) => ({ r, b: await getBalance(DEMO_ACCOUNTS[r]) })));
  const donor = balances.sort((a, b) => (a.b > b.b ? -1 : 1))[0];
  if (!donor || donor.b < want + RESERVE) throw new RelayError("The demo accounts are out of testnet NEAR. Please try again later.");
  await (await account(donor.r)).sendMoney(DEMO_ACCOUNTS[role], want);
}

function panicMessage(e: unknown): string {
  const text = String((e as Error)?.message ?? e);
  const m = /Smart contract panicked: ([^"\\]+)/.exec(text) || /ExecutionError":"([^"]+)"/.exec(text);
  return m ? m[1].trim() : text.slice(0, 300);
}

/** Signs one contract call as a guest account and waits for the final result. */
export async function relay(role: Role, method: string, args: Record<string, unknown>) {
  if (!ALLOWED[role]?.includes(method)) throw new RelayError(`The ${role} account cannot call ${method}.`);

  // Everything below is decided from on-chain data, never from the client,
  // and before any signature or transfer between the demo accounts.
  let deposit = 0n;
  if (method === "withdraw_owed") {
    // Pays only the calling demo account what the contract already owes it.
  } else if (method === "create_vehicle") {
    deposit = VEHICLE_DEPOSIT;
  } else if ("sale_id" in args) {
    const sale = await getSale(Number(args.sale_id));
    if (!sale) throw new RelayError("No such sale.");
    if (!inDemoScope(sale.seller, sale)) throw new RelayError(OUT_OF_SCOPE);
    if (method === "fund_sale") {
      if (BigInt(sale.price) > MAX_GUEST_PRICE) throw new RelayError("Guest purchases are capped at 3 testnet NEAR.");
      deposit = BigInt(sale.price);
    }
  } else {
    const vehicle = await getVehicle(Number(args.vehicle_id));
    if (!vehicle) throw new RelayError("No such passport.");
    if (!inDemoScope(vehicle.owner)) throw new RelayError(OUT_OF_SCOPE);
    if (method === "list_for_sale") {
      let price: bigint;
      try { price = BigInt(String(args.price)); } catch { throw new RelayError("Malformed price."); }
      if (price > MAX_GUEST_PRICE) throw new RelayError("Guest listings are capped at 3 testnet NEAR.");
      deposit = LISTING_FEE;
    }
  }
  if (deposit > 0n) await ensureFunds(role, deposit);

  try {
    const outcome = await (await account(role)).functionCall({
      contractId: CONTRACT_ID,
      methodName: method,
      args,
      gas: GAS,
      attachedDeposit: deposit,
    });
    const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
    if (status.Failure) throw new Error(JSON.stringify(status.Failure));
    const raw = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
    let result: unknown = null;
    try { result = raw ? JSON.parse(raw) : null; } catch { /* a non-JSON return value is not needed by the UI */ }
    return { txHash: outcome.transaction.hash as string, result };
  } catch (e) {
    throw new RelayError(panicMessage(e));
  }
}
