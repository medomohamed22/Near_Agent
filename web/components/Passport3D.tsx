"use client";
import { useRef, useState } from "react";
import { CONTRACT_ID } from "@/lib/config";
import type { Trust } from "@/lib/trust";
import type { Vehicle } from "@/lib/types";

type Props = { vehicle: Vehicle; trust: Trust; labels: { holder: string; records: string; attested: string; trust: string; contract: string; vin: string } };

/** The passport as a card that tilts toward the pointer and flips to show its on-chain identifiers. */
export default function Passport3D({ vehicle, trust, labels }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [flipped, setFlipped] = useState(false);

  const tilt = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${(flipped ? 180 : 0) + x * 16}deg) rotateX(${-y * 12}deg)`;
    el.style.setProperty("--shine", `${x * 80}%`);
  };
  const rest = () => { if (ref.current) ref.current.style.transform = `rotateY(${flipped ? 180 : 0}deg)`; };

  const angle = (trust.score / 100) * 360;
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
        aria-label={`${vehicle.label} passport. ${labels.trust}: ${trust.score} / 100`}
      >
        <div className="passport-face flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold tracking-[0.2em] text-white/70">CARPASS</div>
              <div className="mt-1 text-2xl font-bold leading-tight text-white">{vehicle.label}</div>
              <div className="ltr mt-1 text-white/70">#{String(vehicle.id).padStart(4, "0")}</div>
            </div>
            <div
              className="grid h-20 w-20 shrink-0 place-items-center rounded-full"
              style={{ background: `conic-gradient(#5eead4 ${angle}deg, rgba(255,255,255,0.15) 0)` }}
            >
              <div className="grid h-16 w-16 place-items-center rounded-full bg-[#0f2f33] text-center leading-none">
                <span className="text-2xl font-bold text-white">{trust.score}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-white/90">
            <div><div className="text-xs text-white/60">{labels.records}</div><div className="font-semibold">{vehicle.record_count}</div></div>
            <div><div className="text-xs text-white/60">{labels.attested}</div><div className="font-semibold">{vehicle.attested_count}</div></div>
            <div className="col-span-2"><div className="text-xs text-white/60">{labels.holder}</div><div className="ltr text-white">{vehicle.owner}</div></div>
          </div>
        </div>
        <div className="passport-face passport-back flex flex-col justify-between text-white">
          <div className="text-xs font-semibold tracking-[0.2em] text-white/70">ON-CHAIN</div>
          <div className="space-y-2 text-sm">
            <div><div className="text-xs text-white/60">{labels.contract}</div><div className="ltr">{CONTRACT_ID}</div></div>
            <div><div className="text-xs text-white/60">{labels.vin} · SHA-256</div><div className="ltr text-white/90">{vehicle.vin_hash}</div></div>
          </div>
          <div className="text-xs text-white/60">NEAR testnet</div>
        </div>
      </button>
    </div>
  );
}
