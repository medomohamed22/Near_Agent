// Creates the demo accounts on NEAR testnet, deploys the CarPass contract and
// initialises it. Safe to re-run: existing accounts and state are left alone.
//
//   cd contract && cargo build --target wasm32-unknown-unknown --release
//   cd ../scripts && npm install && node deploy.mjs
import { readFileSync } from 'node:fs';
import {
  accountIds, loadKeys, saveKeys, connectNear, accountExists, createViaFaucet, explorerTx, txHash, WASM_FILE,
} from './lib.mjs';

const TIMEOUT_SEC = Number(process.env.TIMEOUT_SEC || 120);
const ids = accountIds();
const keys = loadKeys();

let near = await connectNear(keys);
for (const accountId of Object.values(ids)) {
  if (keys[accountId]) continue;
  if (await accountExists(near, accountId)) {
    throw new Error(`${accountId} exists but its key is not in .keys.json; set CARPASS_PREFIX to use new accounts`);
  }
  keys[accountId] = await createViaFaucet(accountId);
  saveKeys(keys);
  console.log('created', accountId);
}
near = await connectNear(keys);

const contract = await near.account(ids.contract);
const deployed = await contract.deployContract(readFileSync(WASM_FILE));
console.log('deployed', ids.contract, explorerTx(txHash(deployed)));

const admin = await near.account(ids.admin);
const config = await contract.viewFunction({ contractId: ids.contract, methodName: 'get_config' }).catch(() => null);
if (!config) {
  const init = await contract.functionCall({
    contractId: ids.contract,
    methodName: 'new',
    args: { admin: ids.admin, timeout_sec: TIMEOUT_SEC },
  });
  console.log('initialised', explorerTx(txHash(init)));
}

const isAttester = await admin.viewFunction({
  contractId: ids.contract, methodName: 'is_attester', args: { account_id: ids.workshop },
});
if (!isAttester) {
  const added = await admin.functionCall({
    contractId: ids.contract, methodName: 'add_attester', args: { account_id: ids.workshop },
  });
  console.log('workshop approved', explorerTx(txHash(added)));
}

console.log(await admin.viewFunction({ contractId: ids.contract, methodName: 'get_config' }));
