// Seeds the demo: two passports with sample documents, workshop attestations,
// one odometer conflict and one open listing. Run once after deploy.mjs.
//
//   APP_URL=https://<your-app>.vercel.app node seed.mjs      (default http://localhost:3000)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { accountIds, connectNear, explorerTx, txHash } from './lib.mjs';

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const SAMPLES = fileURLToPath(new URL('../web/public/samples/', import.meta.url));
const samples = JSON.parse(readFileSync(new URL('../web/lib/samples.json', import.meta.url), 'utf8'));
const ids = accountIds();
const near = await connectNear();
const account = (role) => near.account(ids[role]);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const view = async (methodName, args = {}) => (await account('admin')).viewFunction({ contractId: ids.contract, methodName, args });

async function call(role, methodName, args, deposit = '0') {
  const out = await (await account(role)).functionCall({
    contractId: ids.contract, methodName, args, gas: 60000000000000n, attachedDeposit: BigInt(deposit),
  });
  console.log(`${role} ${methodName}`, explorerTx(txHash(out)));
  const value = out.status?.SuccessValue;
  return value ? JSON.parse(Buffer.from(value, 'base64').toString()) : null;
}

/** Stores the sample's file and reviewed fields in the app, then registers its hash on chain. */
async function addSample(role, vehicleId, file) {
  const sample = samples.find((s) => s.file === file);
  const form = new FormData();
  form.set('file', new Blob([readFileSync(SAMPLES + file)], { type: 'image/png' }), file);
  form.set('vehicleId', String(vehicleId));
  form.set('extraction', JSON.stringify({ ...sample.extraction, summary: sample.extraction.summary.en, summary_i18n: sample.extraction.summary }));
  const res = await fetch(`${APP_URL}/api/documents`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`storing ${file} failed: ${res.status} ${await res.text()}`);
  const x = sample.extraction;
  return call(role, 'add_record', {
    vehicle_id: vehicleId, kind: x.kind, doc_hash: sample.sha256, event_date: x.event_date, odometer_km: x.odometer_km,
  });
}

if ((await view('get_config')).vehicle_count > 0) {
  console.log('The contract already has passports; nothing seeded.');
  process.exit(0);
}

const DEPOSIT = '100000000000000000000000'; // 0.1 NEAR, the passport's storage deposit
const LISTING_FEE = '10000000000000000000000'; // 0.01 NEAR
// The VINs are made up. Same salted hash as web/lib/hash.ts.
const vin = (v) => sha256(`carpass:vin:${v}`);

const corolla = await call('seller', 'create_vehicle', { label: 'Toyota Corolla 2018', vin_hash: vin('DEMO0COROLLA2018X') }, DEPOSIT);
const first = await addSample('seller', corolla, 'corolla-2022-service.png');
await call('workshop', 'attest_record', { vehicle_id: corolla, index: first.index });
await addSample('workshop', corolla, 'corolla-2023-inspection.png');
await addSample('seller', corolla, 'corolla-2024-service.png');
await call('seller', 'list_for_sale', { vehicle_id: corolla, price: '2000000000000000000000000' }, LISTING_FEE);

const elantra = await call('seller', 'create_vehicle', { label: 'Hyundai Elantra 2016', vin_hash: vin('DEMO0ELANTRA2016X') }, DEPOSIT);
await addSample('workshop', elantra, 'elantra-2021-accident-repair.png');
await addSample('seller', elantra, 'elantra-2023-service.png');

console.log(await view('get_vehicles'));
