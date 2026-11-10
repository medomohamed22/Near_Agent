import { describe, expect, it } from "vitest";
import { formatNear, parseNear } from "../lib/chain";
import { sha256Hex, vinHash } from "../lib/hash";
import { formatDate, parseDate, wouldConflict } from "../lib/odometer";
import { trustScore } from "../lib/trust";
import type { CarRecord, Vehicle } from "../lib/types";

const rec = (index: number, event_date: number, odometer_km: number | null, odometer_conflict = false): CarRecord => ({
  index, kind: "Maintenance", doc_hash: "a".repeat(64), event_date, odometer_km,
  added_by: "seller.testnet", attested_by: null, odometer_conflict, created_at_ms: 0,
});

const car = (over: Partial<Vehicle>): Vehicle => ({
  id: 1, owner: "seller.testnet", label: "Car", vin_hash: "b".repeat(64), record_count: 0, attested_count: 0,
  last_odometer_km: 0, last_odometer_date: 0, odometer_conflicts: 0, active_sale: null, created_at_ms: 0, ...over,
});

describe("odometer", () => {
  const history = [rec(0, 20230101, 10_000), rec(1, 20240101, 12_000)];

  it("flags a later document with fewer kilometres", () => {
    expect(wouldConflict(history, 20250101, 11_500)).toBe(true);
  });
  it("accepts a later document with more kilometres", () => {
    expect(wouldConflict(history, 20250101, 12_500)).toBe(false);
  });
  it("flags an earlier document with more kilometres", () => {
    expect(wouldConflict(history, 20220101, 13_000)).toBe(true);
  });
  it("accepts the first reading", () => {
    expect(wouldConflict([], 20250101, 5)).toBe(false);
    expect(wouldConflict([rec(0, 20230101, null)], 20250101, 5)).toBe(false);
  });
  it("catches a rollback against an earlier document even when a later one is higher", () => {
    // 100k in 2022 and 130k in 2024 are on file; 90k dated 2023 is below 2022.
    const onFile = [rec(0, 20220101, 100_000), rec(1, 20240101, 130_000)];
    expect(wouldConflict(onFile, 20230101, 90_000)).toBe(true);
    expect(wouldConflict(onFile, 20230101, 110_000)).toBe(false);
  });
  it("does not compare readings dated the same day", () => {
    expect(wouldConflict([rec(0, 20240101, 50_000)], 20240101, 49_990)).toBe(false);
  });
  it("does not compare against readings already flagged", () => {
    expect(wouldConflict([...history, rec(2, 20250101, 99_000, true)], 20250601, 12_800)).toBe(false);
  });
});

describe("dates", () => {
  it("round-trips", () => {
    expect(parseDate("2024-02-29")).toBe(20240229);
    expect(formatDate(20240229)).toBe("2024-02-29");
  });
  it("rejects dates that do not exist", () => {
    expect(parseDate("2023-02-29")).toBeNull();
    expect(parseDate("2024-13-01")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
});

describe("trust score", () => {
  const none = { completed: 0, cancelled: 0, disputes_lost: 0 };
  const readings = (n: number) => Array.from({ length: n }, (_, i) => rec(i, 20200101 + i * 10000, 10_000 * (i + 1)));

  it("is zero for an empty passport", () => {
    expect(trustScore(car({}), none, []).score).toBe(0);
  });
  it("reaches 100 only with full attestation, depth, consistent readings and seller history", () => {
    const full = car({ record_count: 6, attested_count: 6 });
    expect(trustScore(full, { completed: 3, cancelled: 0, disputes_lost: 0 }, readings(6)).score).toBe(100);
  });
  it("loses the odometer points on any conflict", () => {
    const base = car({ record_count: 6, attested_count: 6 });
    const clean = trustScore(base, none, readings(6)).score;
    const flagged = trustScore({ ...base, odometer_conflicts: 1 }, none, readings(6)).score;
    expect(clean - flagged).toBe(20);
  });
  it("gives no odometer points without two readings to compare, and says so", () => {
    for (const recs of [[], [rec(0, 20240101, null)], readings(1)]) {
      const part = trustScore(car({ record_count: 1 }), none, recs).parts.find((p) => p.key === "odometer")!;
      expect(part.points).toBe(0);
      expect(part.insufficient).toBe(true);
    }
    const two = trustScore(car({ record_count: 2 }), none, readings(2)).parts.find((p) => p.key === "odometer")!;
    expect(two.points).toBe(20);
    expect(two.insufficient).toBe(false);
  });
  it("gives nothing for records only the seller vouches for, beyond depth and odometer", () => {
    const t = trustScore(car({ record_count: 3, attested_count: 0 }), none, readings(3));
    expect(t.parts.find((p) => p.key === "attested")?.points).toBe(0);
    expect(t.score).toBe(13 + 20);
  });
});

describe("NEAR amounts", () => {
  it("converts to and from yoctoNEAR", () => {
    expect(parseNear("2")).toBe("2000000000000000000000000");
    expect(parseNear("0.1")).toBe("100000000000000000000000");
    expect(formatNear("2500000000000000000000000")).toBe("2.5");
    expect(formatNear("2000000000000000000000000")).toBe("2");
  });
  it("never rounds a price", () => {
    for (const exact of ["0.00999", "1.99999", "0.000000000000000000000001", "3"]) expect(formatNear(parseNear(exact))).toBe(exact);
    expect(formatNear("1")).toBe("0.000000000000000000000001");
  });
  it("rejects anything that is not a positive decimal", () => {
    for (const bad of ["", "0", "-1", "1e3", "abc", "1.2.3"]) expect(() => parseNear(bad)).toThrow();
  });
});

describe("hashing", () => {
  it("matches a known SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("hashes a VIN the same regardless of case and spacing", async () => {
    expect(await vinHash(" demo0corolla2018x ")).toBe(await vinHash("DEMO0COROLLA2018X"));
    expect(await vinHash("DEMO0COROLLA2018X")).toBe("dc126045c90fb0611e2f7d1d8c178b10e6f9a5dce10459f24d24dbc3bb9df6d6");
  });
});
