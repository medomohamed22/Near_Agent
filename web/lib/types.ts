export const RECORD_KINDS = ["Maintenance", "Inspection", "Accident", "Warranty", "Insurance", "Odometer"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export type Vehicle = {
  id: number;
  owner: string;
  label: string;
  vin_hash: string;
  record_count: number;
  attested_count: number;
  last_odometer_km: number;
  last_odometer_date: number;
  odometer_conflicts: number;
  active_sale: number | null;
  created_at_ms: number;
};

export type CarRecord = {
  index: number;
  kind: RecordKind;
  doc_hash: string;
  event_date: number;
  odometer_km: number | null;
  added_by: string;
  attested_by: string | null;
  odometer_conflict: boolean;
  created_at_ms: number;
};

export type SaleStatus = "Listed" | "Funded" | "HandedOver" | "Completed" | "Cancelled" | "Refunded" | "Disputed";

export type Sale = {
  id: number;
  vehicle_id: number;
  seller: string;
  buyer: string | null;
  /** yoctoNEAR, as a decimal string. */
  price: string;
  status: SaleStatus;
  deadline_ms: number;
  dispute_hash: string | null;
  dispute_opened_by: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type SellerStats = { completed: number; cancelled: number; disputes_lost: number };

export type ChainConfig = {
  admin: string;
  timeout_sec: number;
  vehicle_count: number;
  sale_count: number;
  vehicle_deposit: string;
};

/** What the AI read from a document, after the uploader reviewed it. */
export type Extraction = {
  kind: RecordKind;
  event_date: number | null;
  odometer_km: number | null;
  provider_name: string | null;
  summary: string;
  /** The same summary in each interface language, when both are known (the seeded samples). */
  summary_i18n?: { en?: string; ar?: string };
  /** Field name -> the exact words in the document that support it. */
  evidence: Partial<Record<"kind" | "event_date" | "odometer_km" | "provider_name", string>>;
  warnings: string[];
};

export type ExtractResponse = {
  sha256: string;
  extraction: Extraction;
  /** "live" came from the model just now; "fixture" is a stored sample; "manual" means fill it in by hand. */
  source: "live" | "fixture" | "manual";
  note?: string;
};

export type AskResponse = {
  answer: string;
  citations: number[];
  unknowns: string[];
  source: "live" | "offline";
};

export type RelayResponse = { ok: true; txHash: string; result: unknown } | { ok: false; error: string };
