"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchDocuments, relayCall } from "@/lib/api";
import { getConfig, getRecords, getSale, getSellerStats, getVehicles, parseNear, view } from "@/lib/chain";
import { CONTRACT_ID, DEMO_ACCOUNTS, ROLES, accountUrl, txUrl, type Role } from "@/lib/config";
import { vinHash } from "@/lib/hash";
import { dict, type Key } from "@/lib/i18n";
import { useLang, useTheme } from "@/lib/prefs";
import { trustScore } from "@/lib/trust";
import type { CarRecord, Extraction, RecordKind, Sale, SellerStats, Vehicle } from "@/lib/types";
import { connectWallet, disconnectWallet, onWalletChange, restoreWallet, walletCall } from "@/lib/wallet";
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
type Health = { ai: { live: boolean } };

const VEHICLE_DEPOSIT = parseNear("0.1");
const i = (n: number) => ({ "--i": n }) as CSSProperties;

const Sun = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const Moon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
  </svg>
);

export default function CarPassApp() {
  const [lang, setLang] = useLang();
  const [theme, setTheme] = useTheme();
  const [role, setRole] = useState<Role>("seller");
  const [wallet, setWallet] = useState<string | null>(null);
  const [walletIsWorkshop, setWalletIsWorkshop] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [admin, setAdmin] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [filter, setFilter] = useState<{ kinds: RecordKind[]; zone: string | null } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [scrolled, setScrolled] = useState(false);
  /** Last sale seen per passport, so a sale stays on screen after it closes. */
  const lastSale = useRef(new Map<number, number>());
  const txId = useRef(0);

  const t = useCallback((k: Key) => dict[lang][k], [lang]);

  // Who is acting. A connected wallet is the person's own account; otherwise
  // the visitor plays one of the shared guest accounts.
  const me = wallet ?? DEMO_ACCOUNTS[role];
  const canTrade = wallet ? true : role === "seller" || role === "buyer";
  const isWorkshop = wallet ? walletIsWorkshop : role === "workshop";
  const isReviewer = wallet ? wallet === admin : role === "reviewer";
  const vehicle = vehicles?.find((v) => v.id === selected) ?? null;

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
      // The score describes whoever is selling: the seller of the sale on screen, else the holder.
      const sellerStats = sale && sale.seller !== v.owner ? await getSellerStats(sale.seller) : stats;
      setDetail({ records, docs, sale, stats: sellerStats });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  // First load, honouring a passport link (?v=<passport>) and a handover link (&confirm=<sale>).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = Number(params.get("v")) || null;
    if (params.get("confirm")) setRole("buyer");
    loadVehicles().then((list) => {
      if (!list?.length) return;
      setSelected(list.find((v) => v.id === wanted)?.id ?? list[0].id);
    });
    getConfig().then((c) => setAdmin(c.admin)).catch(() => undefined);
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    restoreWallet().then(setWallet);
    let stop = () => {};
    onWalletChange(setWallet).then((off) => { stop = off; }).catch(() => undefined);
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { stop(); window.removeEventListener("scroll", onScroll); };
  }, [loadVehicles]);

  // A wallet account may be an approved workshop; the contract says so.
  useEffect(() => {
    let live = true;
    const check = wallet ? view<boolean>("is_attester", { account_id: wallet }).catch(() => false) : Promise.resolve(false);
    check.then((yes) => { if (live) setWalletIsWorkshop(yes); });
    return () => { live = false; };
  }, [wallet]);

  const refresh = useCallback(async () => {
    const list = await loadVehicles();
    const v = list?.find((x) => x.id === selected);
    if (v) await loadDetail(v);
  }, [loadVehicles, loadDetail, selected]);

  const open = (id: number) => {
    if (id === selected) return;
    setDetail(null);
    setFilter(null);
    setSelected(id);
  };
  const loaded = vehicles !== null;
  useEffect(() => {
    const v = vehicles?.find((x) => x.id === selected);
    if (v) loadDetail(v);
    // Reload only when another passport is opened; `refresh` covers changes to the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, loaded]);

  // The other party may act from another device, so keep the open passport fresh.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  /**
   * Sends one contract call (through the person's wallet, or the guest signer),
   * tracks it in the activity list, then reloads. Returns the call's result, or
   * null on failure. `deposit` is yoctoNEAR and only used with a wallet: the
   * guest signer works deposits out on the server.
   */
  const act = useCallback(async (label: string, method: string, args: Record<string, unknown>, deposit?: string) => {
    const id = ++txId.current;
    setTxs((list) => [{ id, label, status: "pending" as const }, ...list].slice(0, 12));
    try {
      const out = wallet ? await walletCall(method, args, deposit) : await relayCall(role, method, args);
      setTxs((list) => list.map((x) => (x.id === id ? { ...x, status: "success", hash: out.txHash } : x)));
      return out.result;
    } catch (e) {
      setTxs((list) => list.map((x) => (x.id === id ? { ...x, status: "failed", error: (e as Error).message } : x)));
      return null;
    } finally {
      await refresh();
    }
  }, [refresh, role, wallet]);

  const connect = async () => {
    setConnecting(true);
    try { setWallet(await connectWallet()); } catch { /* the person closed the chooser */ } finally { setConnecting(false); }
  };

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
      z("engine", dict[lang].kind_Maintenance, ["Maintenance"], [1.65, 1.25, 0]),
      z("body", dict[lang].kind_Accident, ["Accident"], [-2.0, 1.2, 0], count(["Accident"]) > 0),
      z("dash", `${dict[lang].kind_Inspection} · ${dict[lang].kind_Odometer}`, ["Inspection", "Odometer"], [-0.1, 1.85, 0], conflict),
      z("cover", `${dict[lang].kind_Warranty} · ${dict[lang].kind_Insurance}`, ["Warranty", "Insurance"], [0, 0.55, 1.15]),
    ];
  }, [records, lang]);

  const trust = vehicle && detail ? trustScore(vehicle, detail.stats) : null;
  const isHolder = !!vehicle && vehicle.owner === me;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <a href="#main" className="btn sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50">Skip to content</a>

      <header className={`site-header flex flex-wrap items-center gap-x-3 gap-y-2 ${scrolled ? "scrolled" : ""}`}>
        <div className="flex items-center gap-3">
          <div className="logo grid h-10 w-10 place-items-center rounded-xl text-base font-black text-white" aria-hidden>CP</div>
          <div><div className="text-lg font-bold leading-none tracking-tight">CarPass</div><div className="hidden text-xs muted sm:block">{t("tagline")}</div></div>
        </div>
        <span className="badge badge-warn"><span className="dot" aria-hidden />{t("testnet")}</span>
        {health && <span className={`badge max-sm:!hidden ${health.ai.live ? "badge-ok" : "badge-warn"}`}>{health.ai.live ? t("ai_on") : t("ai_off")}</span>}
        <span className="grow" />
        {wallet ? (
          <button type="button" className="btn btn-sm" onClick={() => disconnectWallet().then(() => setWallet(null))}>{t("disconnect")}</button>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={connect} disabled={connecting}><Busy on={connecting}>{connecting ? t("connecting") : t("connect")}</Busy></button>
        )}
        <button type="button" className="btn btn-round" onClick={() => setLang(lang === "ar" ? "en" : "ar")} aria-label={lang === "ar" ? t("toEnglish") : t("toArabic")} title={lang === "ar" ? t("toEnglish") : t("toArabic")}>
          {lang === "ar" ? "EN" : "AR"}
        </button>
        <button type="button" className="btn btn-round" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? t("toLight") : t("toDark")} title={theme === "dark" ? t("toLight") : t("toDark")}>
          <span key={theme} className="theme-icon grid place-items-center">{theme === "dark" ? <Sun /> : <Moon />}</span>
        </button>
      </header>

      <section className="reveal pb-2 pt-8 sm:pt-12">
        <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">{t("heroA")} <span className="gradient-text">{t("heroB")}</span></h1>
        <p className="mt-3 max-w-2xl text-base muted sm:text-lg">{t("heroSub")}</p>
        <ul className="mt-4 flex flex-wrap gap-2 text-sm">
          {(["feat1", "feat2", "feat3"] as const).map((k, n) => (
            <li key={k} className="badge badge-brand reveal !px-3 !py-1" style={i(n + 2)}>✓ {t(k)}</li>
          ))}
        </ul>
      </section>

      <div className="card reveal mt-6 flex flex-wrap items-center gap-x-4 gap-y-2" style={i(1)}>
        {wallet ? (
          <>
            <span className="badge badge-ok"><span className="dot" aria-hidden />{t("walletMode")}</span>
            <Account id={wallet} />
            {isWorkshop && <span className="badge badge-brand">{t("walletWorkshop")}</span>}
            {isReviewer && <span className="badge badge-brand">{t("walletReviewer")}</span>}
            <p className="basis-full text-xs muted">{t("walletNote")} {t("needTestnet")}</p>
          </>
        ) : (
          <>
            <span className="badge">{t("guestMode")}</span>
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
          </>
        )}
      </div>

      <main id="main" className="mt-6 space-y-6">
        {loadError && (
          <Notice tone="danger">{t("loadError")} <button type="button" className="underline" onClick={refresh}>{t("retry")}</button></Notice>
        )}

        <nav className="reveal flex flex-wrap items-center gap-2" style={i(2)} aria-label={t("passports")}>
          <span className="text-sm font-semibold">{t("passports")}</span>
          {vehicles === null && !loadError && <span className="spinner" />}
          {vehicles?.length === 0 && <span className="text-sm muted">{t("noPassports")}</span>}
          {vehicles?.map((v) => (
            <button key={v.id} type="button" className={`btn btn-sm ${selected === v.id ? "btn-primary" : ""}`} aria-current={selected === v.id ? "page" : undefined} onClick={() => open(v.id)}>
              {v.label}
              {v.odometer_conflicts > 0 && <span aria-label={t("badge_conflict")}>⚠</span>}
              {v.active_sale != null && <span className="dot" aria-label={t("sale")} />}
            </button>
          ))}
          {canTrade && (
            <button type="button" className="btn btn-sm" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>＋ {t("newPassport")}</button>
          )}
        </nav>

        {creating && (
          <NewPassport t={t} onCancel={() => setCreating(false)} onCreate={async (label, vin) => {
            const id = await act(`${t("newPassport")}: ${label}`, "create_vehicle", { label, vin_hash: await vinHash(vin) }, VEHICLE_DEPOSIT);
            if (typeof id === "number") { open(id); setCreating(false); }
          }} />
        )}

        {vehicle && trust && detail && (
          <>
            <section className="grid gap-6 lg:grid-cols-[minmax(0,430px)_1fr]">
              <div className="space-y-5">
                <div className="reveal" style={i(1)}>
                  <Passport3D key={vehicle.id} vehicle={vehicle} trust={trust} labels={{ holder: t("holder"), records: t("records"), attested: t("attested"), trust: t("trust"), contract: t("contract"), vin: t("vin"), flip: t("flip"), scan: t("scan") }} />
                </div>
                <div className="card reveal" style={i(2)}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="h2">{t("trust")}</h2>
                    <div><span className="gradient-text text-3xl font-extrabold">{trust.score}</span><span className="muted"> / 100</span></div>
                  </div>
                  <ul className="mt-3 space-y-2.5">
                    {trust.parts.map((p) => (
                      <li key={p.key}>
                        <div className="flex justify-between text-sm"><span>{t(`part_${p.key}` as Key)}</span><span className="ltr muted">{p.points} / {p.max}</span></div>
                        <div className="bar mt-1" role="presentation"><i style={{ width: `${(p.points / p.max) * 100}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs muted">{t("trustNote")}</p>
                </div>
              </div>

              <div className="card reveal flex flex-col" style={i(2)}>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="muted">{t("holder")}{isHolder ? ` (${t("you")})` : ""}</dt><dd><Account id={vehicle.owner} /></dd></div>
                  <div><dt className="muted">{t("lastOdometer")}</dt><dd className="font-semibold">{vehicle.last_odometer_date ? <><span className="ltr text-base">{vehicle.last_odometer_km.toLocaleString("en")}</span> {t("km")}</> : "—"}</dd></div>
                  <div><dt className="muted">{t("attested")}</dt><dd className="font-semibold"><span className="ltr text-base">{vehicle.attested_count} / {vehicle.record_count}</span></dd></div>
                  <div><dt className="muted">{t("conflicts")}</dt><dd className={`font-semibold ${vehicle.odometer_conflicts ? "text-danger" : "text-ok"}`}>{vehicle.odometer_conflicts ? `⚠ ${vehicle.odometer_conflicts}` : t("none")}</dd></div>
                </dl>
                <div className="stage relative mt-4 min-h-[360px] grow overflow-hidden rounded-2xl border border-line">
                  <div className="absolute inset-0"><Car3D dark={theme === "dark"} zones={zones} active={filter?.zone ?? null} onPick={(z) => setFilter(z ? { kinds: z.kinds, zone: z.id } : null)} /></div>
                  <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs muted">{t("filterHint")}</p>
                </div>
              </div>
            </section>

            <SalePanel t={t} vehicle={vehicle} sale={detail.sale} stats={detail.stats} me={me} canTrade={canTrade} isReviewer={isReviewer}
              act={async (label, method, args, deposit) => { await act(`${t("sale")}: ${label}`, method, args, deposit); }} />

            <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
              <div className="space-y-6">
                <Timeline t={t} vehicleId={vehicle.id} records={detail.records} docs={detail.docs}
                  filter={filter?.kinds ?? null} onFilter={(kinds) => setFilter(kinds ? { kinds, zone: null } : null)}
                  canAttest={isWorkshop && !isHolder} flash={flash}
                  onAttest={async (index) => { await act(`${t("attest")} #${index + 1}`, "attest_record", { vehicle_id: vehicle.id, index }); }} />
                <AddRecord t={t} lang={lang} vehicleId={vehicle.id} records={detail.records} allowed={isHolder || isWorkshop}
                  onSubmit={async (a) => {
                    const out = await act(`${t("addRecord")}: ${t(`kind_${a.kind}` as Key)}`, "add_record", { vehicle_id: vehicle.id, ...a });
                    if (out === null) throw new Error(t("failed"));
                  }} />
              </div>
              <div className="space-y-6">
                <AskPanel key={vehicle.id} t={t} lang={lang} vehicleId={vehicle.id} onCite={cite} />
                <section className="card reveal" style={i(4)} aria-labelledby="tx-h">
                  <h2 id="tx-h" className="h2">{t("activity")}</h2>
                  {txs.length === 0 ? <p className="mt-2 text-sm muted">{t("noActivity")}</p> : (
                    <ul className="mt-3 space-y-2" aria-live="polite">
                      {txs.map((x) => (
                        <li key={x.id} className="card-2 slide-in text-sm">
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
        {vehicle && !detail && !loadError && <div className="card grid place-items-center py-20"><span className="spinner" /></div>}
      </main>

      <footer className="mt-12 space-y-2 border-t border-line pt-5 text-xs muted">
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
    <form className="card pop grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); await onCreate(label.trim(), vin).finally(() => setBusy(false)); }}>
      <div><label className="label" htmlFor="np-label">{t("carName")}</label><input id="np-label" className="input" maxLength={64} placeholder={t("carNamePh")} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      <div><label className="label" htmlFor="np-vin">{t("vin")}</label><input id="np-vin" className="input ltr" maxLength={17} value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} aria-describedby="np-vin-note" /></div>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={!ok || busy}><Busy on={busy}>{t("create")}</Busy></button><button type="button" className="btn" onClick={onCancel}>{t("cancel")}</button></div>
      <p id="np-vin-note" className="text-xs muted sm:col-span-3">{t("vinNote")}</p>
    </form>
  );
}
