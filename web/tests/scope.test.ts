import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS, inDemoScope } from "../lib/config";

const wallet = "someone.testnet";
const { seller, buyer } = DEMO_ACCOUNTS;

describe("guest scope", () => {
  it("covers passports held by a demo account", () => {
    expect(inDemoScope(seller)).toBe(true);
    expect(inDemoScope(wallet)).toBe(false);
  });
  it("covers a sale only when every party is a demo account", () => {
    expect(inDemoScope(seller, { seller, buyer: null })).toBe(true);
    expect(inDemoScope(seller, { seller, buyer })).toBe(true);
    expect(inDemoScope(seller, { seller, buyer: wallet })).toBe(false);
    expect(inDemoScope(wallet, { seller: wallet, buyer })).toBe(false);
    expect(inDemoScope(wallet, { seller: wallet, buyer: null })).toBe(false);
  });
});
