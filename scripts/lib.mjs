// Shared helpers for the CarPass testnet scripts.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect, keyStores, KeyPair } from 'near-api-js';

export const NETWORK = 'testnet';
export const RPC_URL = process.env.RPC_URL || 'https://rpc.testnet.fastnear.com';
export const FAUCET_URL = 'https://helper.testnet.near.org/account';
export const KEYS_FILE = fileURLToPath(new URL('./.keys.json', import.meta.url));
export const WASM_FILE = fileURLToPath(
  new URL('../contract/target/wasm32-unknown-unknown/release/carpass.wasm', import.meta.url),
);

/** Role -> account id. Override the prefix to deploy a fresh set of accounts. */
export function accountIds(prefix = process.env.CARPASS_PREFIX || 'carpass') {
  return {
    contract: process.env.CARPASS_CONTRACT || `${prefix}-v5.testnet`,
    admin: `${prefix}-admin.testnet`,
    seller: `${prefix}-seller.testnet`,
    buyer: `${prefix}-buyer.testnet`,
    workshop: `${prefix}-warsha.testnet`,
  };
}

/** Private keys by account id. Testnet only; this file is git-ignored. */
export function loadKeys() {
  return existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
}

export function saveKeys(keys) {
  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

export async function connectNear(keys = loadKeys()) {
  const keyStore = new keyStores.InMemoryKeyStore();
  for (const [accountId, secret] of Object.entries(keys)) {
    await keyStore.setKey(NETWORK, accountId, KeyPair.fromString(secret));
  }
  return connect({ networkId: NETWORK, nodeUrl: RPC_URL, keyStore });
}

export async function accountExists(near, accountId) {
  try {
    await (await near.account(accountId)).state();
    return true;
  } catch (e) {
    if (e?.type === 'AccountDoesNotExist' || /does(n't| not) exist|UNKNOWN_ACCOUNT/i.test(String(e?.message || e))) return false;
    throw e;
  }
}

/** Asks the testnet faucet to create and fund `accountId`. */
export async function createViaFaucet(accountId) {
  const keyPair = KeyPair.fromRandom('ed25519');
  const res = await fetch(FAUCET_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet refused ${accountId}: ${res.status} ${await res.text()}`);
  return keyPair.toString();
}

export const explorerTx = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;
export const txHash = (outcome) => outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id;
