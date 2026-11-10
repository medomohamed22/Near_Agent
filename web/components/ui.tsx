"use client";
import { useState, type ReactNode } from "react";
import { accountUrl } from "@/lib/config";

/** A hash, account id or other identifier: always left-to-right, with a copy button. */
export function Mono({ value, short = false, href }: { value: string; short?: boolean; href?: string }) {
  const [copied, setCopied] = useState(false);
  const shown = short && value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {href ? (
        <a className="ltr underline decoration-dotted underline-offset-2 hover:text-brand" href={href} target="_blank" rel="noreferrer">{shown}</a>
      ) : (
        <span className="ltr" title={value}>{shown}</span>
      )}
      <button
        type="button"
        className="rounded px-1 text-xs text-muted hover:text-brand"
        aria-label={`Copy ${value}`}
        onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

export const Account = ({ id }: { id: string }) => <Mono value={id} href={accountUrl(id)} />;

export function Busy({ on, children }: { on: boolean; children: ReactNode }) {
  return <>{on && <span className="spinner" aria-hidden />}{children}</>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const cls = { info: "border-line text-muted", warn: "border-warn/40 text-warn", danger: "border-danger/50 text-danger", ok: "border-ok/40 text-ok" }[tone];
  return <p role={tone === "danger" ? "alert" : "status"} className={`pop rounded-xl border bg-surface-2 px-3 py-2 text-sm ${cls}`}>{children}</p>;
}
