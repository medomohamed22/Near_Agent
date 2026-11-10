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
export const getVehicles = () => view<Vehicle[]>("get_vehicles", { limit: 50 });
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
  const m = /^(\d{1,6})(?:\.(\d{1,5}))?$/.exec(amount.trim());
  if (!m) throw new Error("amount must be a number like 2 or 2.5");
  const yocto = BigInt(m[1]) * YOCTO + BigInt((m[2] || "").padEnd(24, "0"));
  if (yocto <= 0n) throw new Error("amount must be greater than zero");
  return yocto.toString();
}

/** yoctoNEAR -> "2.5" with up to 2 decimals. */
export function formatNear(yocto: string | bigint): string {
  const v = BigInt(yocto);
  const whole = v / YOCTO;
  const cents = ((v % YOCTO) * 100n) / YOCTO;
  return cents === 0n ? whole.toString() : `${whole}.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
}
