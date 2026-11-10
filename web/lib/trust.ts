import type { SellerStats, Vehicle } from "./types";

export type TrustPart = { key: "attested" | "depth" | "odometer" | "seller"; points: number; max: number };
export type Trust = { score: number; parts: TrustPart[] };

/**
 * A fixed, published formula over on-chain numbers. It measures how complete
 * and how independently confirmed the record is. It says nothing about the
 * mechanical condition of the car.
 */
export function trustScore(vehicle: Vehicle, seller: SellerStats): Trust {
  const records = vehicle.record_count;
  const parts: TrustPart[] = [
    { key: "attested", max: 40, points: records ? Math.round((40 * vehicle.attested_count) / records) : 0 },
    { key: "depth", max: 25, points: Math.round(25 * Math.min(records / 6, 1)) },
    { key: "odometer", max: 20, points: records && vehicle.odometer_conflicts === 0 ? 20 : 0 },
    { key: "seller", max: 15, points: Math.round(15 * Math.min(seller.completed / 3, 1)) },
  ];
  return { score: parts.reduce((sum, p) => sum + p.points, 0), parts };
}
