"use client";
import { useState } from "react";
import { askQuestion } from "@/lib/api";
import type { Key, Lang } from "@/lib/i18n";
import type { AskResponse } from "@/lib/types";
import { Busy, Notice } from "./ui";

type Props = { t: (k: Key) => string; lang: Lang; vehicleId: number; onCite: (index: number) => void };

export default function AskPanel({ t, lang, vehicleId, onCite }: Props) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AskResponse | null>(null);
  const [error, setError] = useState("");

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 2 || busy) return;
    setQuestion(text);
    setBusy(true);
    setError("");
    setReply(null);
    try {
      setReply(await askQuestion(vehicleId, text, lang));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="ask-h">
      <h2 id="ask-h" className="h2">{t("ask")}</h2>
      <p className="mt-1 text-sm muted">{t("askHint")}</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
        <label htmlFor="ask-q" className="sr-only">{t("ask")}</label>
        <input id="ask-q" className="input" maxLength={300} placeholder={t("askPh")} value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button className="btn btn-primary shrink-0" disabled={busy || question.trim().length < 2}><Busy on={busy}>{t("askBtn")}</Busy></button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["q1", "q2", "q3"] as const).map((k) => (
          <button key={k} type="button" className="btn btn-sm" disabled={busy} onClick={() => ask(t(k))}>{t(k)}</button>
        ))}
      </div>
      <div className="mt-3" aria-live="polite">
        {busy && <p className="text-sm muted">{t("asking")}</p>}
        {error && <Notice tone="danger">{error}</Notice>}
        {reply && (
          <div className="card-2">
            {reply.source === "offline" && <p className="mb-2"><span className="badge badge-warn">{t("offline")}</span></p>}
            <p>{reply.answer}</p>
            {reply.citations.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="muted">{t("sources")}:</span>
                {reply.citations.map((i) => (
                  <button key={i} type="button" className="badge badge-brand cursor-pointer" onClick={() => onCite(i)}>#{i + 1}</button>
                ))}
              </p>
            )}
            {reply.unknowns.length > 0 && (
              <p className="mt-2 text-sm text-warn">{t("notCovered")}: {reply.unknowns.join(" · ")}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
