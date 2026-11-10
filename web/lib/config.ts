/** CarPass runs on NEAR testnet only. Nothing here can point at mainnet. */
export const NETWORK = "testnet" as const;
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "carpass-v4.testnet";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.testnet.fastnear.com";
export const EXPLORER = "https://testnet.nearblocks.io";

if (!CONTRACT_ID.endsWith(".testnet")) {
  throw new Error(`CarPass is testnet-only; refusing contract id "${CONTRACT_ID}"`);
}

export const ROLES = ["seller", "buyer", "workshop", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

/** Guest accounts the demo signs with on the server. */
export const DEMO_ACCOUNTS: Record<Role, string> = {
  seller: process.env.NEXT_PUBLIC_DEMO_SELLER || "carpass-seller.testnet",
  buyer: process.env.NEXT_PUBLIC_DEMO_BUYER || "carpass-buyer.testnet",
  workshop: process.env.NEXT_PUBLIC_DEMO_WORKSHOP || "carpass-warsha.testnet",
  reviewer: process.env.NEXT_PUBLIC_DEMO_ADMIN || "carpass-admin.testnet",
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MIME = ["image/jpeg", "image/png", "image/webp"];

export const txUrl = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const accountUrl = (id: string) => `${EXPLORER}/address/${id}`;

/** A demo account is one of the shared guest accounts; anything else is someone's own wallet. */
export const isDemoAccount = (id: string | null | undefined) => !!id && Object.values(DEMO_ACCOUNTS).includes(id);

/**
 * Guest accounts may only touch the demo: passports held by a demo account
 * and sales whose parties are all demo accounts.
 */
export function inDemoScope(vehicleOwner: string, sale?: { seller: string; buyer: string | null } | null): boolean {
  if (sale) return isDemoAccount(sale.seller) && (sale.buyer === null || isDemoAccount(sale.buyer));
  return isDemoAccount(vehicleOwner);
}

/** Fixed contract charges, in NEAR. */
export const VEHICLE_DEPOSIT_NEAR = "0.1";
export const LISTING_FEE_NEAR = "0.01";
