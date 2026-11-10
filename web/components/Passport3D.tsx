"use client";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { CONTRACT_ID } from "@/lib/config";
import type { Trust } from "@/lib/trust";
import type { Vehicle } from "@/lib/types";

type Labels = { holder: string; records: string; attested: string; trust: string; contract: string; vin: string; flip: string; scan: string };
type Props = { vehicle: Vehicle; trust: Trust; labels: Labels };

/** Counts up to `value` once, so the score lands instead of just appearing. */
function useCountUp(value: number) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const from = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - from) / 900);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

/**
 * The passport as a physical card: it tilts toward the pointer with a
 * holographic sheen, its text floats above the surface, and it flips to show
 * the on-chain identifiers and a QR link to this passport.
 */
export default function Passport3D({ vehicle, trust, labels }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [flipped, setFlipped] = useState(false);
  const [qr, setQr] = useState("");
  const score = useCountUp(trust.score);

  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/?v=${vehicle.id}`, { margin: 1, width: 180, color: { dark: "#1f1a5c", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [vehicle.id]);

  const tilt = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.transform = `rotateY(${(flipped ? 180 : 0) + (x - 0.5) * 22}deg) rotateX(${-(y - 0.5) * 16}deg) scale(1.02)`;
    el.style.setProperty("--gx", `${(flipped ? 1 - x : x) * 100}%`);
    el.style.setProperty("--gy", `${y * 100}%`);
    el.style.setProperty("--hue", String(Math.round(x * 180 + y * 120)));
  };
  const rest = () => { if (ref.current) ref.current.style.transform = `rotateY(${flipped ? 180 : 0}deg)`; };

  const dash = 2 * Math.PI * 34;
  const id = String(vehicle.id).padStart(4, "0");
  const mrz = `P<NEAR<CARPASS<${id}<<${vehicle.vin_hash.slice(0, 18).toUpperCase()}<<<<<<<<<<`;

  return (
    <div className="scene">
      <button
        ref={ref}
        type="button"
        className={`passport ${flipped ? "flipped" : ""}`}
        style={{ transform: `rotateY(${flipped ? 180 : 0}deg)` }}
        onPointerMove={tilt}
        onPointerLeave={rest}
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
        aria-label={`${vehicle.label}. ${labels.trust}: ${trust.score} / 100. ${labels.flip}`}
      >
        <span className="passport-face flex flex-col justify-between">
          <span className="passport-layer flex items-start justify-between gap-3">
            <span>
              <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.28em] text-white/80">
                <span className="passport-chip" aria-hidden />CARPASS
              </span>
              <span className="mt-3 block text-2xl font-bold leading-tight tracking-tight sm:text-[1.7rem]">{vehicle.label}</span>
              <span className="ltr mt-0.5 block text-white/70">№ {id}</span>
            </span>
            <span className="relative grid h-[84px] w-[84px] shrink-0 place-items-center">
              <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="40" cy="40" r="34" fill="rgba(10,8,50,0.35)" stroke="rgba(255,255,255,0.2)" strokeWidth="6" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="url(#score)" strokeWidth="6" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={dash * (1 - score / 100)} />
                <defs><linearGradient id="score" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7af0ff" /><stop offset="1" stopColor="#fff3a8" /></linearGradient></defs>
              </svg>
              <span className="relative text-center leading-none"><span className="block text-2xl font-bold">{score}</span><span className="text-[10px] text-white/70">/ 100</span></span>
            </span>
          </span>
          <span className="passport-layer block">
            <span className="grid grid-cols-[auto_auto_1fr] gap-x-6 gap-y-1 text-sm">
              <span><span className="block text-[11px] text-white/65">{labels.records}</span><span className="font-semibold">{vehicle.record_count}</span></span>
              <span><span className="block text-[11px] text-white/65">{labels.attested}</span><span className="font-semibold">{vehicle.attested_count}</span></span>
              <span className="min-w-0"><span className="block text-[11px] text-white/65">{labels.holder}</span><span className="ltr block truncate text-white">{vehicle.owner}</span></span>
            </span>
            <span className="mrz mt-2 block">{mrz}</span>
          </span>
        </span>
        <span className="passport-face passport-back flex items-center justify-between gap-4">
          <span className="passport-layer min-w-0 space-y-2 text-sm">
            <span className="block text-[11px] font-semibold tracking-[0.28em] text-white/75">ON-CHAIN · NEAR TESTNET</span>
            <span className="block"><span className="block text-[11px] text-white/65">{labels.contract}</span><span className="ltr block">{CONTRACT_ID}</span></span>
            <span className="block"><span className="block text-[11px] text-white/65">{labels.vin} · SHA-256</span><span className="ltr block text-white/90">{vehicle.vin_hash}</span></span>
          </span>
          {qr && (
            <span className="passport-layer shrink-0 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL */}
              <img src={qr} alt="" width={96} height={96} className="rounded-xl shadow-lg" />
              <span className="mt-1 block text-[10px] text-white/75">{labels.scan}</span>
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
