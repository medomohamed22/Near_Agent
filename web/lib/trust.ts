import type { CarRecord, SellerStats, Vehicle } from "./types";

export type TrustPart = {
  key: "attested" | "depth" | "odometer" | "seller";
  points: number;
  max: number;
  /** Set when the part scores zero because there is too little to judge, not because something is wrong. */
  insufficient?: boolean;
};
export type Trust = { score: number; parts: TrustPart[] };

/**
 * A fixed, published formula over on-chain numbers. It measures how complete
 * and how independently confirmed the record is. It says nothing about the
 * mechanical condition of the car.
 */
export function trustScore(vehicle: Vehicle, seller: SellerStats, records: CarRecord[]): Trust {
  const count = vehicle.record_count;
  // Consistency can only be judged from at least two readings that agree.
  const readings = records.filter((r) => r.odometer_km != null && !r.odometer_conflict).length;
  const consistent = vehicle.odometer_conflicts === 0 && readings >= 2;
  const parts: TrustPart[] = [
    { key: "attested", max: 40, points: count ? Math.round((40 * vehicle.attested_count) / count) : 0 },
    { key: "depth", max: 25, points: Math.round(25 * Math.min(count / 6, 1)) },
    { key: "odometer", max: 20, points: consistent ? 20 : 0, insufficient: vehicle.odometer_conflicts === 0 && readings < 2 },
    { key: "seller", max: 15, points: Math.round(15 * Math.min(seller.completed / 3, 1)) },
  ];
  return { score: parts.reduce((sum, p) => sum + p.points, 0), parts };
}
