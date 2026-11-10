"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDocuments, relayCall } from "@/lib/api";
import { getRecords, getSale, getSellerStats, getVehicles } from "@/lib/chain";
import { CONTRACT_ID, DEMO_ACCOUNTS, ROLES, accountUrl, txUrl, type Role } from "@/lib/config";
import { vinHash } from "@/lib/hash";
import { dict, type Key, type Lang } from "@/lib/i18n";
import { trustScore } from "@/lib/trust";
import type { CarRecord, Extraction, RecordKind, Sale, SellerStats, Vehicle } from "@/lib/types";
import AddRecord from "./AddRecord";
import AskPanel from "./AskPanel";
import type { Zone } from "./Car3D";
import Passport3D from "./Passport3D";
import SalePanel from "./SalePanel";
import Timeline from "./Timeline";
import { Account, Busy, Notice } from "./ui";

const Car3D = dynamic(() => import("./Car3D"), { ssr: false, loading: () => <div className="grid h-full place-items-center"><span className="spinner" /></div> });

type Tx = { id: number; label: string; status: "pending" | "success" | "failed"; hash?: string; error?: string };
type Detail = { records: CarRecord[]; docs: Record<string, Extraction>; sale: Sale | null; stats: SellerStats };
type Health = { ai: { live: boolean }; guest: { ready: boolean } };

export default function CarPassApp() {
  const [lang, setLang] = useState<Lang>("en");
  const [role, setRole] = useState<Role>("seller");
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [filter, setFilter] = useState<{ kinds: RecordKind[]; zone: string | null } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  /** Last sale seen per passport, so a sale stays on screen after it closes. */
  const lastSale = useRef(new Map<number, number>());
  const txId = useRef(0);

  const t = useCallback((k: Key) => dict[lang][k], [lang]);
  const me = DEMO_ACCOUNTS[role];
  const vehicle = vehicles?.find((v) => v.id === selected) ?? null;

  // Language: saved choice, else the browser's. Keeps <html lang/dir> in step.
  useEffect(() => {
    const saved = localStorage.getItem("carpass-lang");
    setLang(saved === "ar" || saved === "en" ? saved : navigator.language.startsWith("ar") ? "ar" : "en");
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const loadVehicles = useCallback(async () => {
    try {
      const list = await getVehicles();
      setVehicles(list);
      setLoadError(false);
      return list;
    } catch {
      setLoadError(true);
      return null;
    }
  }, []);

  const loadDetail = useCallback(async (v: Vehicle) => {
    try {
      if (v.active_sale != null) lastSale.current.set(v.id, v.active_sale);
      const saleId = v.active_sale ?? lastSale.current.get(v.id) ?? null;
      const [records, docs, sale, stats] = await Promise.all([
        getRecords(v.id),
        fetchDocuments(v.id),
        saleId != null ? getSale(saleId) : Promise.resolve(null),
        getSellerStats(v.owner),
      ]);
      // The score describes whoever is selling: the seller of an open sale, else the holder.
      const sellerStats = sale && sale.seller !== v.owner ? await getSellerStats(sale.seller) : stats;
      setDetail({ records, docs, sale, stats: sellerStats });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  // First load, honouring a handover link (?v=<passport>&confirm=<sale>).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = Number(params.get("v")) || null;
    if (params.get("confirm")) setRole("buyer");
    loadVehicles().then((list) => {
      if (!list?.length) return;
      setSelected(list.find((v) => v.id === wanted)?.id ?? list[0].id);
    });
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, [loadVehicles]);

  const refresh = useCallback(async () => {
    const list = await loadVehicles();
    const v = list?.find((x) => x.id === selected);
    if (v) await loadDetail(v);
  }, [loadVehicles, loadDetail, selected]);

  useEffect(() => {
    setDetail(null);
    setFilter(null);
    if (vehicle) loadDetail(vehicle);
    // Reload only when another passport is opened; `refresh` covers changes to the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, vehicles === null]);

  // The other party may act from another device, so keep the open passport fresh.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  /** Sends one contract call, tracks it in the activity list, then reloads. Returns the call's result, or null on failure. */
  const act = useCallback(async (label: string, as: Role, method: string, args: Record<string, unknown>) => {
    const id = ++txId.current;
    setTxs((list) => [{ id, label, status: "pending" as const }, ...list].slice(0, 12));
    try {
      const out = await relayCall(as, method, args);
      setTxs((list) => list.map((x) => (x.id === id ? { ...x, status: "success", hash: out.txHash } : x)));
      return out.result;
    } catch (e) {
      setTxs((list) => list.map((x) => (x.id === id ? { ...x, status: "failed", error: (e as Error).message } : x)));
      return null;
    } finally {
      await refresh();
    }
  }, [refresh]);

  const cite = (index: number) => {
    setFilter(null);
    setFlash(index);
    setTimeout(() => document.getElementById(`rec-${index}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    setTimeout(() => setFlash(null), 1800);
  };

  const records = detail?.records;
  const zones: Zone[] = useMemo(() => {
    const count = (kinds: RecordKind[]) => (records ?? []).filter((r) => kinds.includes(r.kind)).length;
    const conflict = (records ?? []).some((r) => r.odometer_conflict);
    const z = (id: string, label: string, kinds: RecordKind[], position: [number, number, number], alert = false): Zone => ({ id, label, kinds, position, count: count(kinds), alert });
    return [
      z("engine", dict[lang].kind_Maintenance, ["Maintenance"], [1.55, 1.15, 0]),
      z("body", dict[lang].kind_Accident, ["Accident"], [-1.6, 1.0, 0.85], count(["Accident"]) > 0),
      z("dash", `${dict[lang].kind_Inspection} · ${dict[lang].kind_Odometer}`, ["Inspection", "Odometer"], [-0.15, 1.75, 0], conflict),
      z("cover", `${dict[lang].kind_Warranty} · ${dict[lang].kind_Insurance}`, ["Warranty", "Insurance"], [-0.2, 0.3, 1.2]),
    ];
  }, [records, lang]);

  const trust = vehicle && detail ? trustScore(vehicle, detail.stats) : null;
  const isHolder = !!vehicle && vehicle.owner === me;
  const canAdd = isHolder || role === "workshop";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 btn">Skip to content</a>
      <header className="flex flex-wrap items-center gap-3 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-lg font-black text-[#04211d]">CP</div>
          <div><div className="text-xl font-bold leading-none">CarPass</div><div className="text-xs muted">{t("tagline")}</div></div>
        </div>
        <span className="badge badge-warn">{t("testnet")}</span>
        {health && <span className={`badge ${health.ai.live ? "badge-ok" : "badge-warn"}`}>{health.ai.live ? t("ai_on") : t("ai_off")}</span>}
        <span className="grow" />
        <button type="button" className="btn btn-sm" onClick={() => { const next = lang === "ar" ? "en" : "ar"; setLang(next); localStorage.setItem("carpass-lang", next); }} aria-label="Switch language">
          {lang === "ar" ? "English" : "العربية"}
        </button>
      </header>

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm muted" id="role-l">{t("actingAs")}</span>
        <div role="radiogroup" aria-labelledby="role-l" className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r} className={`btn btn-sm ${role === r ? "btn-primary" : ""}`} onClick={() => setRole(r)}>
              {t(`role_${r}` as Key)}
            </button>
          ))}
        </div>
        <Account id={me} />
        <p className="basis-full text-xs muted">{t("guestNote")}</p>
      </div>

      <main id="main" className="mt-5 space-y-5">
        {loadError && (
          <Notice tone="danger">{t("loadError")} <button type="button" className="underline" onClick={refresh}>{t("retry")}</button></Notice>
        )}

        <nav className="flex flex-wrap items-center gap-2" aria-label={t("passports")}>
          <span className="text-sm font-semibold">{t("passports")}</span>
          {vehicles === null && !loadError && <span className="spinner" />}
          {vehicles?.length === 0 && <span className="text-sm muted">{t("noPassports")}</span>}
          {vehicles?.map((v) => (
            <button key={v.id} type="button" className={`btn btn-sm ${selected === v.id ? "btn-primary" : ""}`} aria-current={selected === v.id ? "page" : undefined} onClick={() => setSelected(v.id)}>
              {v.label}
              {v.odometer_conflicts > 0 && <span aria-label={t("badge_conflict")}>⚠</span>}
              {v.active_sale != null && <span className="ltr text-xs opacity-80">●</span>}
            </button>
          ))}
          {(role === "seller" || role === "buyer") && (
            <button type="button" className="btn btn-sm" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>＋ {t("newPassport")}</button>
          )}
        </nav>

        {creating && (
          <NewPassport t={t} onCancel={() => setCreating(false)} onCreate={async (label, vin) => {
            const id = await act(`${t("newPassport")}: ${label}`, role, "create_vehicle", { label, vin_hash: await vinHash(vin) });
            if (typeof id === "number") { setSelected(id); setCreating(false); }
          }} />
        )}

        {vehicle && trust && detail && (
          <>
            <section className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
              <div className="space-y-4">
                <Passport3D vehicle={vehicle} trust={trust} labels={{ holder: t("holder"), records: t("records"), attested: t("attested"), trust: t("trust"), contract: t("contract"), vin: t("vin") }} />
                <div className="card">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="h2">{t("trust")}</h2>
                    <div><span className="text-3xl font-bold text-brand">{trust.score}</span><span className="muted"> / 100</span></div>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {trust.parts.map((p) => (
                      <li key={p.key}>
                        <div className="flex justify-between text-sm"><span>{t(`part_${p.key}` as Key)}</span><span className="ltr">{p.points} / {p.max}</span></div>
                        <div className="mt-1 h-1.5 rounded-full bg-line" role="presentation"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(p.points / p.max) * 100}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs muted">{t("trustNote")}</p>
                </div>
              </div>

              <div className="card flex flex-col">
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="muted">{t("holder")}{isHolder ? ` (${t("you")})` : ""}</dt><dd><Account id={vehicle.owner} /></dd></div>
                  <div><dt className="muted">{t("lastOdometer")}</dt><dd className="font-semibold">{vehicle.last_odometer_date ? <><span className="ltr text-base">{vehicle.last_odometer_km.toLocaleString("en")}</span> {t("km")}</> : "—"}</dd></div>
                  <div><dt className="muted">{t("attested")}</dt><dd className="font-semibold"><span className="ltr text-base">{vehicle.attested_count} / {vehicle.record_count}</span></dd></div>
                  <div><dt className="muted">{t("conflicts")}</dt><dd className={`font-semibold ${vehicle.odometer_conflicts ? "text-danger" : "text-ok"}`}>{vehicle.odometer_conflicts ? `⚠ ${vehicle.odometer_conflicts}` : t("none")}</dd></div>
                </dl>
                <div className="relative mt-3 h-[340px] overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-[#0e1830] to-[#0a1020]">
                  <div className="absolute inset-0"><Car3D zones={zones} active={filter?.zone ?? null} onPick={(z) => setFilter(z ? { kinds: z.kinds, zone: z.id } : null)} /></div>
                  <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs muted">{t("filterHint")}</p>
                </div>
              </div>
            </section>

            <SalePanel t={t} vehicle={vehicle} sale={detail.sale} stats={detail.stats} me={me} role={role}
              act={async (label, method, args) => { await act(`${t("sale")}: ${label}`, role, method, args); }} />

            <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,380px)]">
              <div className="space-y-5">
                <Timeline t={t} vehicleId={vehicle.id} records={detail.records} docs={detail.docs}
                  filter={filter?.kinds ?? null} onFilter={(kinds) => setFilter(kinds ? { kinds, zone: null } : null)}
                  canAttest={role === "workshop" && !isHolder} flash={flash}
                  onAttest={async (index) => { await act(`${t("attest")} #${index + 1}`, "workshop", "attest_record", { vehicle_id: vehicle.id, index }); }} />
                <AddRecord t={t} lang={lang} vehicleId={vehicle.id} records={detail.records} allowed={canAdd}
                  onSubmit={async (a) => {
                    const out = await act(`${t("addRecord")}: ${t(`kind_${a.kind}` as Key)}`, role, "add_record", { vehicle_id: vehicle.id, ...a });
                    if (out === null) throw new Error(t("failed"));
                  }} />
              </div>
              <div className="space-y-5">
                <AskPanel key={vehicle.id} t={t} lang={lang} vehicleId={vehicle.id} onCite={cite} />
                <section className="card" aria-labelledby="tx-h">
                  <h2 id="tx-h" className="h2">{t("activity")}</h2>
                  {txs.length === 0 ? <p className="mt-2 text-sm muted">{t("noActivity")}</p> : (
                    <ul className="mt-3 space-y-2" aria-live="polite">
                      {txs.map((x) => (
                        <li key={x.id} className="card-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={`badge ${x.status === "success" ? "badge-ok" : x.status === "failed" ? "badge-danger" : ""}`}>
                              <Busy on={x.status === "pending"}>{t(x.status)}</Busy>
                            </span>
                            <span className="min-w-0 truncate">{x.label}</span>
                          </div>
                          {x.hash && <a className="ltr mt-1 block underline decoration-dotted hover:text-brand" href={txUrl(x.hash)} target="_blank" rel="noreferrer">{x.hash}</a>}
                          {x.error && <p className="mt-1 text-danger">{x.error}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </>
        )}
        {vehicle && !detail && !loadError && <div className="card grid place-items-center py-16"><span className="spinner" /></div>}
      </main>

      <footer className="mt-10 space-y-2 border-t border-line pt-5 text-xs muted">
        <p>{t("disclaimer")}</p>
        <p>{t("contract")}: <a className="ltr underline decoration-dotted hover:text-brand" href={accountUrl(CONTRACT_ID)} target="_blank" rel="noreferrer">{CONTRACT_ID}</a></p>
      </footer>
    </div>
  );
}

function NewPassport({ t, onCreate, onCancel }: { t: (k: Key) => string; onCreate: (label: string, vin: string) => Promise<void>; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [vin, setVin] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = label.trim().length > 0 && /^[A-Za-z0-9]{11,17}$/.test(vin.trim());
  return (
    <form className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); await onCreate(label.trim(), vin).finally(() => setBusy(false)); }}>
      <div><label className="label" htmlFor="np-label">{t("carName")}</label><input id="np-label" className="input" maxLength={64} placeholder={t("carNamePh")} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      <div><label className="label" htmlFor="np-vin">{t("vin")}</label><input id="np-vin" className="input ltr" maxLength={17} value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} aria-describedby="np-vin-note" /></div>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={!ok || busy}><Busy on={busy}>{t("create")}</Busy></button><button type="button" className="btn" onClick={onCancel}>{t("cancel")}</button></div>
      <p id="np-vin-note" className="text-xs muted sm:col-span-3">{t("vinNote")}</p>
    </form>
  );
}
