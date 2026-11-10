"use client";
import { useRef, useState } from "react";
import { extractFile, storeDocument } from "@/lib/api";
import { MAX_UPLOAD_BYTES, UPLOAD_MIME } from "@/lib/config";
import type { Key, Lang } from "@/lib/i18n";
import { formatDate, parseDate, wouldConflict } from "@/lib/odometer";
import samples from "@/lib/samples.json";
import { RECORD_KINDS, type CarRecord, type ExtractResponse, type Extraction, type RecordKind } from "@/lib/types";
import { Busy, Mono, Notice } from "./ui";

type Props = {
  t: (k: Key) => string;
  lang: Lang;
  vehicleId: number;
  records: CarRecord[];
  allowed: boolean;
  onSubmit: (args: { kind: RecordKind; doc_hash: string; event_date: number; odometer_km: number | null }) => Promise<void>;
};

type Draft = { kind: RecordKind; date: string; km: string; provider: string; summary: string };

export default function AddRecord({ t, lang, vehicleId, records, allowed, onSubmit }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [read, setRead] = useState<ExtractResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "saving">("idle");
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);

  const reset = () => { setFile(null); setRead(null); setDraft(null); setError(""); setConsent(false); setPreview((p) => { if (p) URL.revokeObjectURL(p); return ""; }); if (input.current) input.current.value = ""; };

  const start = async (f: File) => {
    reset();
    if (!UPLOAD_MIME.includes(f.type)) return setError("JPEG, PNG or WebP only.");
    if (f.size > MAX_UPLOAD_BYTES) return setError("Max 5 MB.");
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setPhase("reading");
    try {
      const r = await extractFile(f, lang);
      const x = r.extraction;
      setRead(r);
      setDraft({ kind: x.kind, date: x.event_date ? formatDate(x.event_date) : "", km: x.odometer_km?.toString() ?? "", provider: x.provider_name ?? "", summary: x.summary });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  };

  const pickSample = async (name: string) => {
    const blob = await (await fetch(`/samples/${name}`)).blob();
    await start(new File([blob], name, { type: "image/png" }));
  };

  const date = draft ? parseDate(draft.date) : null;
  const km = draft && /^\d{1,7}$/.test(draft.km.trim()) ? Number(draft.km) : null;
  const conflict = date != null && km != null && wouldConflict(records, date, km);

  const submit = async () => {
    if (!file || !read || !draft) return;
    if (date == null) return setError(t("needDate"));
    setError("");
    setPhase("saving");
    const reviewed: Extraction = {
      kind: draft.kind, event_date: date, odometer_km: km, provider_name: draft.provider.trim() || null,
      summary: draft.summary.trim(), evidence: read.extraction.evidence, warnings: read.extraction.warnings,
    };
    try {
      // The copy is stored first; it only becomes visible once the hash is on chain.
      await storeDocument(file, vehicleId, reviewed).catch((e: Error) => { throw new Error(`${t("noFile")} (${e.message})`); });
      await onSubmit({ kind: draft.kind, doc_hash: read.sha256, event_date: date, odometer_km: km });
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  };

  const ev = read?.extraction.evidence ?? {};
  const quote = (field: keyof typeof ev) =>
    read?.source === "manual" ? null : (
      <p className="mt-1 text-xs">{ev[field] ? <q className="ltr text-brand">{ev[field]}</q> : <span className="text-warn">{t("noQuote")}</span>}</p>
    );

  return (
    <section className="card reveal" style={{ "--i": 4 } as React.CSSProperties} aria-labelledby="add-h">
      <h2 id="add-h" className="h2">{t("addRecord")}</h2>
      <p className="mt-1 text-sm muted">{t("addRecordHint")}</p>
      {!allowed ? (
        <div className="mt-3"><Notice>{t("onlyHolder")}</Notice></div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept={UPLOAD_MIME.join(",")} className="sr-only" id="doc-file" onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
            <label htmlFor="doc-file" className="btn btn-primary cursor-pointer">{t("chooseFile")}</label>
            {file && <button type="button" className="btn" onClick={reset}>{t("cancel")}</button>}
          </div>
          {!file && (
            <div className="mt-3">
              <p className="text-sm muted">{t("orSample")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {samples.map((s) => (
                  <button key={s.file} type="button" className="btn btn-sm" onClick={() => pickSample(s.file)}>{s.title}{s.file.includes("hidden") ? " ⚑" : ""}</button>
                ))}
              </div>
            </div>
          )}
          {phase === "reading" && <p className="mt-4 flex items-center gap-2 text-sm"><span className="spinner" aria-hidden />{t("reading")}</p>}

          {draft && read && (
            <div className="pop mt-4 grid gap-4 lg:grid-cols-[minmax(0,260px)_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a remote asset */}
              <img src={preview} alt="" className="max-h-80 w-full rounded-xl border border-line object-contain bg-white" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{t("review")}</h3>
                  <span className={`badge ${read.source === "live" ? "badge-ok" : "badge-warn"}`}>{t(`src_${read.source}` as Key)}</span>
                </div>
                {read.extraction.warnings.length > 0 && (
                  <div className="mt-2"><Notice tone="warn">{t("aiWarnings")}: {read.extraction.warnings.join(" · ")}</Notice></div>
                )}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="f-kind">{t("kind")}</label>
                    <select id="f-kind" className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as RecordKind })}>
                      {RECORD_KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}` as Key)}</option>)}
                    </select>
                    {quote("kind")}
                  </div>
                  <div>
                    <label className="label" htmlFor="f-date">{t("date")}</label>
                    <input id="f-date" type="date" className="input ltr" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                    {quote("event_date")}
                  </div>
                  <div>
                    <label className="label" htmlFor="f-km">{t("odometer")}</label>
                    <input id="f-km" inputMode="numeric" className="input ltr" value={draft.km} onChange={(e) => setDraft({ ...draft, km: e.target.value.replace(/[^\d]/g, "") })} />
                    {quote("odometer_km")}
                  </div>
                  <div>
                    <label className="label" htmlFor="f-prov">{t("provider")}</label>
                    <input id="f-prov" className="input" maxLength={120} value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} />
                    {quote("provider_name")}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="f-sum">{t("summary")}</label>
                    <textarea id="f-sum" className="input" rows={2} maxLength={400} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
                  </div>
                </div>
                <p className="mt-3 text-sm"><span className="muted">{t("docHash")}: </span><Mono value={read.sha256} short /></p>
                {conflict && <div className="mt-2"><Notice tone="warn">⚠ {t("willConflict")}</Notice></div>}
                <div className="card-2 mt-3 text-sm">
                  <p className="font-semibold text-warn">⚠ {t("publicNote")}</p>
                  <label className="mt-2 flex cursor-pointer items-start gap-2">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <span>{t("publicConsent")}</span>
                  </label>
                </div>
                <button type="button" className="btn btn-primary mt-3" disabled={phase !== "idle" || !consent} onClick={submit}>
                  <Busy on={phase === "saving"}>{t("record")}</Busy>
                </button>
              </div>
            </div>
          )}
          {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}
        </>
      )}
    </section>
  );
}
