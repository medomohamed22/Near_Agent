"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { askQuestion, documentUrl, extractFile, relayCall, storeDocument } from "@/lib/api";
import { parseNear } from "@/lib/chain";
import { txUrl, type Role } from "@/lib/config";
import { sha256Hex, vinHash } from "@/lib/hash";
import type { Key, Lang } from "@/lib/i18n";
import { formatDate } from "@/lib/odometer";
import samples from "@/lib/samples.json";
import type { CarRecord, Extraction, RecordKind } from "@/lib/types";

type Props = {
  t: (k: Key) => string;
  lang: Lang;
  /** Shows the page as this guest role while a step runs. */
  onRole: (role: Role) => void;
  /** Reloads the passport list and opens the given passport. */
  openPassport: (vehicleId: number) => Promise<void>;
  refresh: () => Promise<void>;
};

const STEPS = ["d_create", "d_read1", "d_attest", "d_read2", "d_list", "d_fund", "d_hand", "d_confirm", "d_read3", "d_ask", "d_verify"] as const;
type StepKey = (typeof STEPS)[number];
type Step = { status: "idle" | "run" | "done" | "fail"; detail?: string; tx?: string };

const focus = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A button that plays the whole product in front of the viewer: it opens a
 * fresh passport and drives it through documents, attestation, an escrowed
 * sale and an odometer conflict. Every step is a real call (the AI, the
 * guest signer, NEAR testnet), so it takes a minute or two.
 */
export default function DemoTour({ t, lang, onRole, openPassport, refresh }: Props) {
  const [steps, setSteps] = useState<Record<string, Step>>({});
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const stop = useRef(false);

  const run = async () => {
    stop.current = false;
    setSteps({});
    setAnswer("");
    setOpen(true);
    setRunning(true);
    let current: StepKey = STEPS[0];
    const mark = (k: StepKey, s: Step) => setSteps((all) => ({ ...all, [k]: { ...all[k], ...s } }));

    // One step: show it running, do the work, show its result. A stop request ends the tour between steps.
    const step = async <T,>(k: StepKey, role: Role | null, anchor: string, work: () => Promise<{ value: T; detail?: string; tx?: string }>): Promise<T> => {
      if (stop.current) throw new Error(t("d_stopped"));
      current = k;
      if (role) onRole(role);
      mark(k, { status: "run" });
      focus(anchor);
      const out = await work();
      mark(k, { status: "done", detail: out.detail, tx: out.tx });
      await refresh();
      await pause(900);
      return out.value;
    };

    // Reads a sample document with the AI, stores the copy, and registers it on chain.
    const addDocument = async (role: Role, vehicleId: number, name: string) => {
      const sample = samples.find((s) => s.file === name)!;
      const file = new File([await (await fetch(`/samples/${name}`)).blob()], name, { type: "image/png" });
      const read = await extractFile(file, lang);
      const x = read.extraction;
      const reviewed: Extraction = {
        ...x,
        kind: (read.source === "manual" ? sample.extraction.kind : x.kind) as RecordKind,
        event_date: x.event_date ?? sample.extraction.event_date,
        odometer_km: x.odometer_km ?? sample.extraction.odometer_km,
        summary: x.summary || sample.extraction.summary[lang],
      };
      await storeDocument(file, vehicleId, reviewed);
      const out = await relayCall(role, "add_record", {
        vehicle_id: vehicleId, kind: reviewed.kind, doc_hash: read.sha256, event_date: reviewed.event_date, odometer_km: reviewed.odometer_km,
      });
      const record = out.result as CarRecord;
      const facts = `${formatDate(record.event_date)} · ${record.odometer_km?.toLocaleString("en")} km`;
      const how = read.source === "live" ? t("d_aiLive") : t("d_aiFallback");
      return { value: record, tx: out.txHash, detail: `${facts} · ${how}${record.odometer_conflict ? ` · ⚠ ${t("badge_conflict")}` : ""}` };
    };

    try {
      const stamp = new Date().toLocaleTimeString("en-GB");
      const vehicleId = await step("d_create", "seller", "main", async () => {
        const vin = `DEMO${Date.now().toString(36).toUpperCase()}`.padEnd(17, "X").slice(0, 17);
        const out = await relayCall("seller", "create_vehicle", { label: `Demo car · ${stamp}`, vin_hash: await vinHash(vin) });
        await openPassport(out.result as number);
        return { value: out.result as number, tx: out.txHash, detail: `#${out.result}` };
      });
      const first = await step("d_read1", "seller", "timeline-h", () => addDocument("seller", vehicleId, "corolla-2022-service.png"));
      await step("d_attest", "workshop", "timeline-h", async () => {
        const out = await relayCall("workshop", "attest_record", { vehicle_id: vehicleId, index: first.index });
        return { value: null, tx: out.txHash };
      });
      await step("d_read2", "seller", "timeline-h", () => addDocument("seller", vehicleId, "corolla-2024-service.png"));
      const saleId = await step("d_list", "seller", "sale-h", async () => {
        const out = await relayCall("seller", "list_for_sale", { vehicle_id: vehicleId, price: parseNear("1") });
        return { value: out.result as number, tx: out.txHash, detail: "1 NEAR" };
      });
      await step("d_fund", "buyer", "sale-h", async () => {
        const out = await relayCall("buyer", "fund_sale", { sale_id: saleId });
        return { value: null, tx: out.txHash };
      });
      await step("d_hand", "seller", "sale-h", async () => {
        const out = await relayCall("seller", "mark_handed_over", { sale_id: saleId });
        return { value: null, tx: out.txHash };
      });
      await step("d_confirm", "buyer", "sale-h", async () => {
        const out = await relayCall("buyer", "confirm_receipt", { sale_id: saleId });
        return { value: null, tx: out.txHash };
      });
      await step("d_read3", "buyer", "timeline-h", () => addDocument("buyer", vehicleId, "corolla-2025-lower-reading.png"));
      await step("d_ask", null, "ask-h", async () => {
        const reply = await askQuestion(vehicleId, t("q3"), lang);
        setAnswer(reply.answer);
        return { value: null, detail: reply.source === "live" ? t("d_aiLive") : t("d_aiFallback") };
      });
      await step("d_verify", null, "timeline-h", async () => {
        const res = await fetch(documentUrl(vehicleId, first.doc_hash), { cache: "no-store" });
        if (!res.ok || (await sha256Hex(await res.arrayBuffer())) !== first.doc_hash) throw new Error(t("mismatch"));
        return { value: null, detail: t("verified") };
      });
    } catch (e) {
      mark(current, { status: "fail", detail: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  const done = STEPS.filter((k) => steps[k]?.status === "done").length;
  const failed = STEPS.some((k) => steps[k]?.status === "fail");
  const finished = !running && done === STEPS.length;

  return (
    <>
      <button type="button" className="btn btn-primary !min-h-[48px] !px-6 !text-base" onClick={running ? () => setOpen(true) : run} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
        {running ? `${t("d_running")} ${done}/${STEPS.length}` : t("d_start")}
      </button>

      {/* Rendered on <body>, so no animated or blurred ancestor can re-anchor the fixed panel. */}
      {open && createPortal(
        <aside className="tour pop" role="dialog" aria-label={t("d_title")}>
          <div className="flex items-center gap-2">
            <h2 className="h2 grow">{t("d_title")}</h2>
            <span className="ltr muted">{done}/{STEPS.length}</span>
            {running && <button type="button" className="btn btn-sm" onClick={() => { stop.current = true; }}>{t("d_stop")}</button>}
            <button type="button" className="btn btn-round !w-8 !min-h-8" onClick={() => setOpen(false)} aria-label={t("cancel")}>✕</button>
          </div>
          <div className="bar mt-2"><i style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>
          <p className="mt-2 text-xs muted">{t("d_note")}</p>
          <ol className="mt-3 space-y-1.5 overflow-y-auto pe-1 text-sm" aria-live="polite">
            {STEPS.map((k, n) => {
              const s = steps[k] ?? { status: "idle" as const };
              return (
                <li key={k} className={`flex gap-2 rounded-lg px-2 py-1 ${s.status === "run" ? "bg-surface-2" : ""} ${s.status === "idle" ? "muted" : ""}`}>
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-xs">
                    {s.status === "run" ? <span className="spinner text-brand" /> : s.status === "done" ? <span className="text-ok">✓</span> : s.status === "fail" ? <span className="text-danger">✕</span> : <span className="ltr">{n + 1}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className={s.status === "run" ? "font-semibold" : ""}>{t(k)}</span>
                    {s.detail && <span className={`block text-xs ${s.status === "fail" ? "text-danger" : "muted"}`}>{s.detail}</span>}
                    {s.tx && <a className="ltr block truncate text-xs underline decoration-dotted hover:text-brand" href={txUrl(s.tx)} target="_blank" rel="noreferrer">{s.tx}</a>}
                  </span>
                </li>
              );
            })}
          </ol>
          {answer && <p className="card-2 mt-3 max-h-32 overflow-y-auto text-sm">{answer}</p>}
          {finished && <p className="mt-3 text-sm font-semibold text-ok">✓ {t("d_done")}</p>}
          {!running && (failed || finished) && <button type="button" className="btn btn-sm mt-3" onClick={run}>{t("d_again")}</button>}
        </aside>,
        document.body,
      )}
    </>
  );
}
