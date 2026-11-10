import type { CarRecord } from "./types";

/**
 * Mirrors the contract's rule so the form can warn before signing: a later
 * document must not show fewer kilometres, an earlier one must not show more.
 * The contract keeps the record either way and flags it.
 */
export function wouldConflict(records: CarRecord[], eventDate: number, km: number): boolean {
  let lastKm = 0;
  let lastDate = 0;
  for (const r of records) {
    if (r.odometer_km == null || r.odometer_conflict) continue;
    if (lastDate === 0 || r.event_date >= lastDate) {
      lastKm = r.odometer_km;
      lastDate = r.event_date;
    }
  }
  if (lastDate === 0) return false;
  return eventDate >= lastDate ? km < lastKm : km > lastKm;
}

/** 20240131 -> "2024-01-31". */
export const formatDate = (d: number) =>
  `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, "0")}-${String(d % 100).padStart(2, "0")}`;

/** "2024-01-31" -> 20240131, or null when it is not a date. */
export function parseDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) return null;
  if (y < 1950 || y > 2100) return null;
  return y * 10000 + mo * 100 + d;
}
