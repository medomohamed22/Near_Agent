"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { formatNear, parseNear } from "@/lib/chain";
import { LISTING_FEE_NEAR } from "@/lib/config";
import { sha256Hex } from "@/lib/hash";
import type { Key } from "@/lib/i18n";
import type { Sale, SaleStatus, SellerStats, Vehicle } from "@/lib/types";
import { Account, Busy, Notice } from "./ui";

type Props = {
  t: (k: Key) => string;
  vehicle: Vehicle;
  sale: Sale | null;
  stats: SellerStats;
  /** Who is acting, and what they may do. */
  me: string;
  canTrade: boolean;
  isReviewer: boolean;
  /** Runs a contract call and resolves when it is final. `deposit` is yoctoNEAR. Errors are shown by the caller. */
  act: (label: string, method: string, args: Record<string, unknown>, deposit?: string) => Promise<void>;
};

const STEPS: SaleStatus[] = ["Listed", "Funded", "HandedOver", "Completed"];
const OPEN: SaleStatus[] = ["Listed", "Funded", "HandedOver", "Disputed"];

function Countdown({ deadline, t }: { deadline: number; t: Props["t"] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (left === 0) return <span className="badge badge-warn">{t("expired")}</span>;
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  return <span className="badge"><span className="muted">{t("deadline")}</span><span className="ltr">{h > 0 ? `${h}:` : ""}{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</span></span>;
}

function HandoverQr({ saleId, vehicleId, t }: { saleId: number; vehicleId: number; t: Props["t"] }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const url = `${window.location.origin}/?v=${vehicleId}&confirm=${saleId}`;
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#10132a", light: "#ffffff" } }).then(setSrc).catch(() => setSrc(""));
  }, [saleId, vehicleId]);
  if (!src) return null;
  return (
    <div className="card-2 pop flex items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL */}
      <img src={src} alt={t("qrTitle")} width={110} height={110} className="rounded-lg" />
      <div><div className="font-semibold">{t("qrTitle")}</div><p className="text-sm muted">{t("qrHint")}</p></div>
    </div>
  );
}

export default function SalePanel({ t, vehicle, sale, stats, me, canTrade, isReviewer, act }: Props) {
  const [price, setPrice] = useState("2");
  const [busy, setBusy] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(id); }, []);

  const run = async (name: string, label: Key, method: string, args: Record<string, unknown>, deposit?: string) => {
    setBusy(name);
    await act(t(label), method, args, deposit).finally(() => setBusy(""));
  };
  const Btn = (name: string, label: Key, method: string, args: Record<string, unknown>, cls = "btn-primary", deposit?: string) => (
    <button key={name} type="button" className={`btn ${cls}`} disabled={!!busy} onClick={() => run(name, label, method, args, deposit)}>
      <Busy on={busy === name}>{t(label)}</Busy>
    </button>
  );

  const isHolder = vehicle.owner === me;
  const open = !!sale && OPEN.includes(sale.status);
  const isSeller = sale?.seller === me;
  const isBuyer = sale?.buyer === me;
  const isParty = isSeller || isBuyer;
  const timedOut = !!sale && sale.deadline_ms > 0 && now >= sale.deadline_ms;

  let priceError = "";
  let priceYocto = "";
  try { priceYocto = parseNear(price); } catch (e) { priceError = (e as Error).message; }

  const hint = (): Key => {
    if (!sale || !open) return "hint_done";
    if (sale.status === "Disputed") return "hint_Disputed";
    if (sale.status === "Listed") return isSeller ? "hint_Listed_other" : "hint_Listed_buyer";
    if (sale.status === "Funded") return isSeller ? "hint_Funded_seller" : "hint_Funded_buyer";
    return isSeller ? "hint_HandedOver_seller" : "hint_HandedOver_buyer";
  };

  const stepIndex = sale ? STEPS.indexOf(sale.status) : -1;
  const offTrack = sale && stepIndex < 0;

  return (
    <section className="card reveal" style={{ "--i": 2 } as React.CSSProperties} aria-labelledby="sale-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="sale-h" className="h2">{t("sale")}</h2>
        {sale && <span className={`badge ${sale.status === "Disputed" ? "badge-danger" : sale.status === "Completed" ? "badge-ok" : offTrack ? "badge-warn" : "badge-brand"}`}>{t(`st_${sale.status}` as Key)}</span>}
        <span className="grow" />
        {open && sale!.deadline_ms > 0 && <Countdown deadline={sale!.deadline_ms} t={t} />}
      </div>

      {sale && (
        <>
          <ol className="mt-4 grid grid-cols-4 gap-2" aria-label={t("status")}>
            {STEPS.map((s, i) => {
              const done = !offTrack && i <= stepIndex;
              return (
                <li key={s} aria-current={i === stepIndex ? "step" : undefined}>
                  <div className="bar"><i style={{ width: done ? "100%" : "0%" }} /></div>
                  <div className={`mt-1 text-xs ${done ? "text-ink" : "muted"}`}>{t(`st_${s}` as Key)}</div>
                </li>
              );
            })}
          </ol>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div className="card-2">
              <dt className="muted">{["Funded", "HandedOver", "Disputed"].includes(sale.status) ? t("held") : t("price")}</dt>
              <dd className="text-xl font-bold"><span className="ltr break-all text-xl">{formatNear(sale.price)}</span> <span className="text-sm font-normal muted">NEAR</span></dd>
            </div>
            <div className="card-2"><dt className="muted">{t("sellerLbl")}{isSeller ? ` (${t("you")})` : ""}</dt><dd><Account id={sale.seller} /></dd></div>
            <div className="card-2"><dt className="muted">{t("buyerLbl")}{isBuyer ? ` (${t("you")})` : ""}</dt><dd>{sale.buyer ? <Account id={sale.buyer} /> : "—"}</dd></div>
          </dl>
          <p className="mt-3 text-sm">{t(hint())}</p>
        </>
      )}

      {open && sale && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {sale.status === "Listed" && !isSeller && canTrade && Btn("fund", "fund", "fund_sale", { sale_id: sale.id }, "btn-primary", sale.price)}
            {sale.status === "Listed" && isSeller && Btn("withdraw", "withdraw", "cancel_sale", { sale_id: sale.id }, "")}
            {sale.status === "Funded" && isSeller && Btn("hand", "handOver", "mark_handed_over", { sale_id: sale.id })}
            {["Funded", "HandedOver"].includes(sale.status) && isBuyer && Btn("confirm", "confirm", "confirm_receipt", { sale_id: sale.id })}
            {sale.status === "Funded" && isParty && Btn("cancel", "backOut", "cancel_sale", { sale_id: sale.id }, "")}
            {["Funded", "HandedOver"].includes(sale.status) && isParty && timedOut && Btn("claim", "claim", "claim_timeout", { sale_id: sale.id }, "")}
            {["Funded", "HandedOver"].includes(sale.status) && isParty && (
              <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => setDisputing((d) => !d)} aria-expanded={disputing}>{t("dispute")}</button>
            )}
            {sale.status === "Disputed" && isReviewer && (
              <>
                {Btn("toSeller", "toSeller", "resolve_dispute", { sale_id: sale.id, release_to_seller: true })}
                {Btn("toBuyer", "toBuyer", "resolve_dispute", { sale_id: sale.id, release_to_seller: false }, "")}
              </>
            )}
          </div>
          {sale.status === "Disputed" && <Notice>{t("reviewerNote")}</Notice>}
          {disputing && ["Funded", "HandedOver"].includes(sale.status) && (
            <form className="card-2 space-y-2" onSubmit={async (e) => {
              e.preventDefault();
              const hash = await sha256Hex(reason.trim());
              await run("dispute", "dispute", "open_dispute", { sale_id: sale.id, evidence_hash: hash });
              setDisputing(false); setReason("");
            }}>
              <label className="label" htmlFor="dispute-reason">{t("disputeHint")}</label>
              <textarea id="dispute-reason" className="input" rows={2} maxLength={500} required minLength={5} placeholder={t("disputePh")} value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn btn-danger" disabled={!!busy}><Busy on={busy === "dispute"}>{t("submitDispute")}</Busy></button>
            </form>
          )}
          {["Funded", "HandedOver"].includes(sale.status) && isSeller && <HandoverQr saleId={sale.id} vehicleId={vehicle.id} t={t} />}
        </div>
      )}

      {!open && (
        <div className="mt-3">
          {!sale && <p className="muted">{t("notForSale")}</p>}
          {isHolder && canTrade && (
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!priceError) run("list", "list", "list_for_sale", { vehicle_id: vehicle.id, price: priceYocto }, parseNear(LISTING_FEE_NEAR)); }}>
              <div>
                <label className="label" htmlFor="sale-price">{t("price")}</label>
                <input id="sale-price" className="input ltr w-32" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={!!priceError} />
              </div>
              <button className="btn btn-primary" disabled={!!busy || !!priceError}><Busy on={busy === "list"}>{t("list")}</Busy></button>
              <p className="basis-full text-xs muted">{t("listFee")}</p>
            </form>
          )}
        </div>
      )}

      <p className="mt-4 text-sm muted">
        {t("sellerHistory")}: <span className="text-ink">{stats.completed}</span> {t("completedSales")} · <span className="text-ink">{stats.cancelled}</span> {t("cancelledSales")} · <span className="text-ink">{stats.disputes_lost}</span> {t("lostDisputes")}
      </p>
    </section>
  );
}
