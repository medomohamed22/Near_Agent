/** CarPass runs on NEAR testnet only. Nothing here can point at mainnet. */
export const NETWORK = "testnet" as const;
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "carpass-v2.testnet";
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
