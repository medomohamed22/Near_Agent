import { CONTRACT_ID, RPC_URL } from "./config";
import type { CarRecord, ChainConfig, Sale, SellerStats, Vehicle } from "./types";

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "carpass", method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`NEAR RPC answered ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.data || body.error.message || "NEAR RPC error");
  return body.result as T;
}

const toBase64 = (s: string) =>
  typeof window === "undefined" ? Buffer.from(s).toString("base64") : btoa(unescape(encodeURIComponent(s)));

/** Calls a read-only contract method. No wallet or key needed. */
export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const out = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: CONTRACT_ID,
    method_name: method,
    args_base64: toBase64(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(out.result))) as T;
}

export const getConfig = () => view<ChainConfig>("get_config");
/** Every passport, read page by page (the contract returns at most 50 per call). */
export async function getVehicles(): Promise<Vehicle[]> {
  const all: Vehicle[] = [];
  for (let from = 1; all.length < 1000; from += 50) {
    const page = await view<Vehicle[]>("get_vehicles", { from, limit: 50 });
    all.push(...page);
    if (page.length < 50) break;
  }
  return all;
}
export const getVehicle = (vehicle_id: number) => view<Vehicle | null>("get_vehicle", { vehicle_id });
export const getRecords = async (vehicle_id: number) => {
  const first = await view<CarRecord[]>("get_records", { vehicle_id, from: 0, limit: 50 });
  if (first.length < 50) return first;
  return first.concat(await view<CarRecord[]>("get_records", { vehicle_id, from: 50, limit: 50 }));
};
export const getSale = (sale_id: number) => view<Sale | null>("get_sale", { sale_id });
export const getSellerStats = (account_id: string) => view<SellerStats>("get_seller_stats", { account_id });

/** Account balance in yoctoNEAR. */
export async function getBalance(accountId: string): Promise<bigint> {
  const out = await rpc<{ amount: string }>("query", {
    request_type: "view_account",
    finality: "optimistic",
    account_id: accountId,
  });
  return BigInt(out.amount);
}

const YOCTO = 10n ** 24n;

/** "2.5" -> yoctoNEAR string. Throws on anything that is not a plain positive decimal. */
export function parseNear(amount: string): string {
  const m = /^(\d{1,6})(?:\.(\d{1,24}))?$/.exec(amount.trim());
  if (!m) throw new Error("amount must be a number like 2 or 2.5");
  const yocto = BigInt(m[1]) * YOCTO + BigInt((m[2] || "").padEnd(24, "0"));
  if (yocto <= 0n) throw new Error("amount must be greater than zero");
  return yocto.toString();
}

/** yoctoNEAR -> exact decimal NEAR, e.g. "2.5" or "0.00999". Never rounds, so a price is shown as it will be charged. */
export function formatNear(yocto: string | bigint): string {
  const v = BigInt(yocto);
  const fraction = (v % YOCTO).toString().padStart(24, "0").replace(/0+$/, "");
  return fraction ? `${v / YOCTO}.${fraction}` : (v / YOCTO).toString();
}
