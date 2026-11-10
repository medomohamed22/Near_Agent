import { beforeEach, describe, expect, it, vi } from "vitest";

// The signer is exercised with the chain and the NEAR client replaced, so the
// tests can assert that a refused request never reaches a signature or a transfer.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the argument is inspected through mock.calls
const functionCall = vi.fn(async (_call: Record<string, unknown>) => ({ status: { SuccessValue: "" }, transaction: { hash: "HASH" } }));
const sendMoney = vi.fn(async () => ({}));
const chain = { sales: new Map<number, unknown>(), vehicles: new Map<number, unknown>(), balance: 0n };

vi.mock("server-only", () => ({}));
vi.mock("near-api-js", () => ({
  connect: async () => ({ account: async () => ({ functionCall, sendMoney }) }),
  keyStores: { InMemoryKeyStore: class { async setKey() {} } },
  KeyPair: { fromString: () => ({}) },
}));
vi.mock("../lib/chain", async (original) => ({
  ...(await original<typeof import("../lib/chain")>()),
  getSale: async (id: number) => chain.sales.get(id) ?? null,
  getVehicle: async (id: number) => chain.vehicles.get(id) ?? null,
  getBalance: async () => chain.balance, // empty by default, so any funding attempt would call sendMoney
}));

for (const k of ["DEMO_SELLER_KEY", "DEMO_BUYER_KEY", "DEMO_WORKSHOP_KEY", "DEMO_ADMIN_KEY"]) process.env[k] = "ed25519:test";

const { relay, RelayError } = await import("../lib/server/near");
const { DEMO_ACCOUNTS } = await import("../lib/config");
const { parseNear } = await import("../lib/chain");

const wallet = "someone.testnet";
const sale = (seller: string, buyer: string | null, near: string) => ({ id: 1, seller, buyer, price: parseNear(near), status: "Listed" });
const untouched = () => { expect(functionCall).not.toHaveBeenCalled(); expect(sendMoney).not.toHaveBeenCalled(); };

beforeEach(() => { functionCall.mockClear(); sendMoney.mockClear(); chain.sales.clear(); chain.vehicles.clear(); chain.balance = 0n; });

describe("guest signer", () => {
  it("refuses to pay for a wallet owner's listing, before moving any funds", async () => {
    chain.sales.set(1, sale(wallet, null, "4"));
    await expect(relay("buyer", "fund_sale", { sale_id: 1 })).rejects.toBeInstanceOf(RelayError);
    untouched();
  });

  it("refuses a demo listing above the cap, before moving any funds", async () => {
    chain.sales.set(1, sale(DEMO_ACCOUNTS.seller, null, "4"));
    await expect(relay("buyer", "fund_sale", { sale_id: 1 })).rejects.toThrow(/capped/);
    untouched();
  });

  it("refuses to settle a dispute between wallets", async () => {
    chain.sales.set(1, sale(wallet, "other.testnet", "1"));
    await expect(relay("reviewer", "resolve_dispute", { sale_id: 1, release_to_seller: true })).rejects.toBeInstanceOf(RelayError);
    untouched();
  });

  it("refuses to settle a dispute where only one side is a demo account", async () => {
    chain.sales.set(1, sale(DEMO_ACCOUNTS.seller, wallet, "1"));
    await expect(relay("reviewer", "resolve_dispute", { sale_id: 1, release_to_seller: true })).rejects.toBeInstanceOf(RelayError);
    untouched();
  });

  it("refuses workshop records and attestations on a wallet owner's passport", async () => {
    chain.vehicles.set(7, { id: 7, owner: wallet });
    await expect(relay("workshop", "attest_record", { vehicle_id: 7, index: 0 })).rejects.toBeInstanceOf(RelayError);
    await expect(relay("workshop", "add_record", { vehicle_id: 7 })).rejects.toBeInstanceOf(RelayError);
    untouched();
  });

  it("refuses methods outside a role's list", async () => {
    await expect(relay("workshop", "resolve_dispute", { sale_id: 1 })).rejects.toBeInstanceOf(RelayError);
    await expect(relay("buyer", "add_attester", { account_id: wallet })).rejects.toBeInstanceOf(RelayError);
    untouched();
  });

  it("settles a dispute inside the demo", async () => {
    chain.sales.set(1, sale(DEMO_ACCOUNTS.seller, DEMO_ACCOUNTS.buyer, "1"));
    await expect(relay("reviewer", "resolve_dispute", { sale_id: 1, release_to_seller: false })).resolves.toMatchObject({ txHash: "HASH" });
    expect(functionCall).toHaveBeenCalledOnce();
  });

  it("attaches the price read from the chain, not one from the client", async () => {
    chain.sales.set(1, sale(DEMO_ACCOUNTS.seller, null, "2"));
    chain.balance = BigInt(parseNear("10"));
    await relay("buyer", "fund_sale", { sale_id: 1, price: "1", deposit: "1" });
    expect(functionCall).toHaveBeenCalledOnce();
    expect(functionCall.mock.calls[0][0]).toMatchObject({ methodName: "fund_sale", attachedDeposit: BigInt(parseNear("2")) });
    expect(sendMoney).not.toHaveBeenCalled();
  });
});
