// End-to-end check of the contract on testnet with real transfers:
// listing fee, escrow release through the payout callback, refund, odometer
// rollback found regardless of entry order, duplicate document refused.
// Run against a throwaway contract so the demo data stays clean:
//   CARPASS_CONTRACT=carpass-smoke.testnet node deploy.mjs && CARPASS_CONTRACT=carpass-smoke.testnet node smoke.mjs
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { accountIds, connectNear } from './lib.mjs';

const ids = accountIds();
const near = await connectNear();
const account = (role) => near.account(ids[role]);
const sha = (s) => createHash('sha256').update(s + Date.now()).digest('hex');
const NEAR = 10n ** 24n;
const view = async (methodName, args = {}) => (await account('admin')).viewFunction({ contractId: ids.contract, methodName, args });
const balance = async (role) => BigInt((await (await account(role)).getAccountBalance()).total);

async function call(role, methodName, args, deposit = 0n) {
  const out = await (await account(role)).functionCall({ contractId: ids.contract, methodName, args, gas: 60000000000000n, attachedDeposit: deposit });
  const value = out.status?.SuccessValue;
  return value ? JSON.parse(Buffer.from(value, 'base64').toString()) : null;
}
const fails = async (promise, pattern) => {
  const error = await promise.then(() => null, (e) => e);
  assert.ok(error, `expected a failure matching ${pattern}`);
  assert.match(String(error.message ?? error), pattern);
};
const step = (name) => console.log('ok  ', name);

const vehicle = await call('seller', 'create_vehicle', { label: 'Smoke test car', vin_hash: sha('vin') }, NEAR / 10n);

// Odometer: 100k in 2022, 130k in 2024, then 90k dated 2023 is a rollback against 2022.
const doc = sha('a');
await call('seller', 'add_record', { vehicle_id: vehicle, kind: 'Odometer', doc_hash: doc, event_date: 20220101, odometer_km: 100000 });
await call('seller', 'add_record', { vehicle_id: vehicle, kind: 'Odometer', doc_hash: sha('b'), event_date: 20240101, odometer_km: 130000 });
const late = await call('seller', 'add_record', { vehicle_id: vehicle, kind: 'Odometer', doc_hash: sha('c'), event_date: 20230101, odometer_km: 90000 });
assert.equal(late.odometer_conflict, true);
assert.equal((await view('get_vehicle', { vehicle_id: vehicle })).last_odometer_km, 130000);
step('rollback entered out of order is flagged');

await fails(call('seller', 'add_record', { vehicle_id: vehicle, kind: 'Maintenance', doc_hash: doc, event_date: 20240601, odometer_km: null }), /already on this passport/);
step('duplicate document is refused');

await fails(call('seller', 'list_for_sale', { vehicle_id: vehicle, price: NEAR.toString() }), /0\.01 NEAR/);
const sale = await call('seller', 'list_for_sale', { vehicle_id: vehicle, price: NEAR.toString() }, NEAR / 100n);
step('listing needs its fee');

await fails(call('buyer', 'fund_sale', { sale_id: sale }, NEAR / 2n), /exactly the listed price/);
const sellerBefore = await balance('seller');
await call('buyer', 'fund_sale', { sale_id: sale }, NEAR);
await call('buyer', 'confirm_receipt', { sale_id: sale });
const gained = (await balance('seller')) - sellerBefore;
assert.equal(gained, NEAR, `seller should gain exactly 1 NEAR, gained ${gained}`);
assert.equal((await view('get_sale', { sale_id: sale })).status, 'Completed');
assert.equal((await view('get_vehicle', { vehicle_id: vehicle })).owner, ids.buyer);
assert.equal(await view('get_owed', { account_id: ids.seller }), '0');
step('escrow released: seller received exactly the price, passport moved, nothing left owed');

const sale2 = await call('buyer', 'list_for_sale', { vehicle_id: vehicle, price: NEAR.toString() }, NEAR / 100n);
const sellerBefore2 = await balance('seller');
await call('seller', 'fund_sale', { sale_id: sale2 }, NEAR);
await call('seller', 'open_dispute', { sale_id: sale2, evidence_hash: sha('evidence') });
await fails(call('seller', 'resolve_dispute', { sale_id: sale2, release_to_seller: false }), /only the admin/);
await fails(call('seller', 'confirm_receipt', { sale_id: sale2 }), /no held payment/);
await call('admin', 'resolve_dispute', { sale_id: sale2, release_to_seller: false });
const net = (await balance('seller')) - sellerBefore2;
assert.ok(net > -NEAR / 50n && net <= 0n, `payer should get the price back, minus gas only; net ${net}`);
assert.equal((await view('get_sale', { sale_id: sale2 })).status, 'Refunded');
step('dispute froze the payment; reviewer refunded the payer');

await fails(call('seller', 'withdraw_owed', {}), /nothing is owed/);
await fails(call('seller', 'on_payout', { account_id: ids.seller, amount: NEAR.toString() }), /private/i);
step('nothing can be claimed that is not owed; the payout callback is private');
console.log('all checks passed on', ids.contract);
