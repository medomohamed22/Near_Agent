"use client";
import { useState } from "react";
import { documentUrl } from "@/lib/api";
import { sha256Hex } from "@/lib/hash";
import type { Key } from "@/lib/i18n";
import { formatDate } from "@/lib/odometer";
import { RECORD_KINDS, type CarRecord, type Extraction, type RecordKind } from "@/lib/types";
import { Account, Busy, Mono, Notice } from "./ui";

type Props = {
  t: (k: Key) => string;
  vehicleId: number;
  records: CarRecord[];
  docs: Record<string, Extraction>;
  filter: RecordKind[] | null;
  onFilter: (kinds: RecordKind[] | null) => void;
  canAttest: boolean;
  onAttest: (index: number) => Promise<void>;
  flash: number | null;
};

type Check = "idle" | "busy" | "match" | "mismatch" | "missing";

function RecordCard({ t, vehicleId, record, doc, canAttest, onAttest, flash }: {
  t: Props["t"]; vehicleId: number; record: CarRecord; doc?: Extraction; canAttest: boolean; onAttest: Props["onAttest"]; flash: boolean;
}) {
  const [check, setCheck] = useState<Check>("idle");
  const [attesting, setAttesting] = useState(false);
  const url = documentUrl(vehicleId, record.doc_hash);

  // Downloads the stored copy and hashes it here, in the browser, against the on-chain hash.
  const verify = async () => {
    setCheck("busy");
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return setCheck("missing");
      setCheck((await sha256Hex(await res.arrayBuffer())) === record.doc_hash ? "match" : "mismatch");
    } catch {
      setCheck("missing");
    }
  };

  const quotes = Object.entries(doc?.evidence ?? {}).filter(([, q]) => !!q);
  return (
    <li id={`rec-${record.index}`} className={`card-2 ${flash ? "flash" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="ltr text-muted">#{record.index + 1}</span>
        <span className="badge badge-brand">{t(`kind_${record.kind}` as Key)}</span>
        <span className="ltr">{formatDate(record.event_date)}</span>
        {record.odometer_km != null && <span className="ltr font-semibold">{record.odometer_km.toLocaleString("en")} km</span>}
        <span className="grow" />
        {record.attested_by ? <span className="badge badge-ok">✓ {t("badge_attested")}</span> : <span className="badge">{t("badge_seller")}</span>}
        {record.odometer_conflict && <span className="badge badge-danger">⚠ {t("badge_conflict")}</span>}
      </div>

      {doc?.summary && <p className="mt-2">{doc.summary}</p>}
      {record.odometer_conflict && <p className="mt-2 text-sm text-warn">{t("conflictNote")}</p>}

      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {doc?.provider_name && <div><dt className="inline muted">{t("provider")}: </dt><dd className="inline">{doc.provider_name}</dd></div>}
        <div><dt className="inline muted">{t("addedBy")}: </dt><dd className="inline"><Account id={record.added_by} /></dd></div>
        {record.attested_by && <div><dt className="inline muted">{t("confirmedBy")}: </dt><dd className="inline"><Account id={record.attested_by} /></dd></div>}
        <div className="sm:col-span-2"><dt className="inline muted">{t("docHash")}: </dt><dd className="inline"><Mono value={record.doc_hash} short /></dd></div>
      </dl>

      {quotes.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer muted">{t("evidence")}</summary>
          <ul className="mt-1 space-y-1">
            {quotes.map(([field, q]) => (
              <li key={field} className="flex gap-2"><span className="muted">{t(field === "event_date" ? "date" : field === "odometer_km" ? "odometer" : field === "provider_name" ? "provider" : "kind")}:</span><q className="ltr">{q}</q></li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">{t("viewDoc")}</a>
        <button type="button" className="btn btn-sm" onClick={verify} disabled={check === "busy"}>
          <Busy on={check === "busy"}>{check === "busy" ? t("verifying") : t("verifyDoc")}</Busy>
        </button>
        {canAttest && !record.attested_by && (
          <button type="button" className="btn btn-sm btn-primary" disabled={attesting}
            onClick={async () => { setAttesting(true); await onAttest(record.index).finally(() => setAttesting(false)); }}>
            <Busy on={attesting}>{t("attest")}</Busy>
          </button>
        )}
      </div>
      {check === "match" && <div className="mt-2"><Notice tone="ok">✓ {t("verified")}</Notice></div>}
      {check === "mismatch" && <div className="mt-2"><Notice tone="danger">{t("mismatch")}</Notice></div>}
      {check === "missing" && <div className="mt-2"><Notice tone="warn">{t("noFile")}</Notice></div>}
    </li>
  );
}

export default function Timeline({ t, vehicleId, records, docs, filter, onFilter, canAttest, onAttest, flash }: Props) {
  const present = RECORD_KINDS.filter((k) => records.some((r) => r.kind === k));
  const shown = records.filter((r) => !filter || filter.includes(r.kind)).sort((a, b) => b.event_date - a.event_date || b.index - a.index);
  const single = filter?.length === 1 ? filter[0] : null;
  return (
    <section className="card" aria-labelledby="timeline-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="timeline-h" className="h2">{t("timeline")}</h2>
        <span className="grow" />
        <button type="button" className={`btn btn-sm ${!filter ? "btn-primary" : ""}`} aria-pressed={!filter} onClick={() => onFilter(null)}>{t("all")}</button>
        {present.map((k) => (
          <button key={k} type="button" className={`btn btn-sm ${single === k ? "btn-primary" : ""}`} aria-pressed={single === k} onClick={() => onFilter(single === k ? null : [k])}>
            {t(`kind_${k}` as Key)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 muted">{t("noRecords")}</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {shown.map((r) => (
            <RecordCard key={r.index} t={t} vehicleId={vehicleId} record={r} doc={docs[r.doc_hash]} canAttest={canAttest} onAttest={onAttest} flash={flash === r.index} />
          ))}
        </ol>
      )}
    </section>
  );
}
