import type { CheckState, PreSendResult } from "@waybill/core";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { TONE_TEXT, type Tone } from "@/components/verdict";
import { checkDeposit } from "@/lib/presend";

type Props = { params: Promise<{ address: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  const value = decodeURIComponent(address);
  return { title: `Waybill · Check ${value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value}` };
}

const VERDICT: Record<PreSendResult["verdict"], { word: string; tone: Tone; lead: string }> = {
  send: { word: "OK to send", tone: "verified", lead: "Every check passed. Send exactly what is below, on the chain below, before the deadline." },
  check: { word: "Check first", tone: "waiting", lead: "Nothing here loses money by itself, but read the warnings before you send." },
  stop: { word: "Do not send", tone: "conflict", lead: "Sending to this address now would not be swapped at these terms, or could be lost." },
};

const MARK: Record<CheckState, { symbol: string; tone: Tone | "muted"; name: string }> = {
  ok: { symbol: "✓", tone: "verified", name: "Passed" },
  info: { symbol: "i", tone: "muted", name: "Note" },
  warn: { symbol: "!", tone: "waiting", name: "Warning" },
  stop: { symbol: "×", tone: "conflict", name: "Stop" },
};

export default async function CheckPage({ params }: Props) {
  const address = decodeURIComponent((await params).address);
  const { obs, failures, result } = await checkDeposit(address);
  const { verdict, instruction, checks } = result;
  const stamp = VERDICT[verdict];
  const ordered = [...checks].sort((a, b) => rank(a.state) - rank(b.state));

  return (
    <article className="space-y-8">
      <div className="sheet rounded-sm px-5 pt-9 pb-7 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-[16rem] grow basis-0 space-y-3">
            <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Before you send</p>
            <h1 className="text-2xl leading-snug font-semibold text-balance sm:text-3xl">{stamp.lead}</h1>
          </div>
          <p className={`stamp shrink-0 px-3 py-1.5 font-mono text-lg font-semibold uppercase ${TONE_TEXT[stamp.tone]}`}>{stamp.word}</p>
        </div>

        {instruction && (
          <div className={`mt-8 border-t border-rule pt-6 ${verdict === "stop" ? "opacity-60" : ""}`}>
            <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">{verdict === "stop" ? "The quote said" : "Send"}</p>
            <p className="mt-2 text-xl leading-snug font-semibold sm:text-2xl">
              {instruction.qualifier && instruction.qualifier !== "any amount" && <span className="text-muted">{instruction.qualifier} </span>}
              {instruction.amount ? <span className="font-mono">{instruction.amount}</span> : instruction.qualifier === "any amount" ? "Any amount of" : "The amount your wallet quoted, in"}{" "}
              {instruction.token}
            </p>
            {instruction.note && <p className="mt-1 text-sm text-pretty text-muted">{instruction.note}</p>}
            <dl className="mt-5 grid gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">To</dt>
              <dd className="break-all">{instruction.address}</dd>
              {instruction.memo && (
                <>
                  <dt className="text-muted">Memo</dt>
                  <dd className="break-all text-waiting">{instruction.memo}</dd>
                </>
              )}
              {instruction.before && (
                <>
                  <dt className="text-muted">Before</dt>
                  <dd>{instruction.before}</dd>
                </>
              )}
            </dl>
            {verdict !== "stop" && (
              <div className="mt-5">
                <CopyButton text={instruction.address} label="Copy deposit address" />
              </div>
            )}
          </div>
        )}
      </div>

      <section className="space-y-3" aria-labelledby="checks">
        <h2 id="checks" className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
          What Waybill checked
        </h2>
        <ul className="divide-y divide-rule border-y border-rule">
          {ordered.map((c) => (
            <li key={c.label} className="grid grid-cols-[1.75rem_1fr] gap-x-3 py-4">
              <span
                className={`mt-0.5 grid size-6 place-items-center rounded-full border-2 border-current font-mono text-xs font-semibold ${TONE_TEXT[MARK[c.state].tone]}`}
              >
                <span aria-hidden>{MARK[c.state].symbol}</span>
                <span className="sr-only">{MARK[c.state].name}</span>
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{c.label}</p>
                <p className="mt-1 leading-relaxed text-pretty text-muted [overflow-wrap:anywhere]">{c.detail}</p>
                {c.rule && (
                  <p className="mt-2 font-mono text-xs text-muted">
                    Documented:{" "}
                    <a href={c.rule.href} className="underline underline-offset-4 hover:text-ink">
                      &ldquo;{c.rule.text}&rdquo;
                    </a>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-wrap items-center gap-4 font-mono text-sm">
        <Link href={`/track/${encodeURIComponent(address)}`} className="underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
          Already sent? Trace this swap
        </Link>
        <Link href="/" className="text-muted underline underline-offset-4 hover:text-ink">
          Check another
        </Link>
      </section>

      <details className="border-t border-rule pt-4">
        <summary className="cursor-pointer font-mono text-xs tracking-[0.14em] text-muted uppercase hover:text-ink">
          Evidence ({obs.evidence.length} responses{failures.length > 0 ? `, ${failures.length} source failures` : ""})
        </summary>
        <ul className="mt-4 divide-y divide-rule font-mono text-xs">
          {obs.evidence.map((e) => (
            <li key={e.id + e.url} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr_auto] sm:gap-4">
              <span className="text-muted">{e.source}</span>
              <span className="break-all">{e.label}</span>
              <span className="text-muted">
                HTTP {e.httpStatus} · {e.sha256.slice(0, 10)}
              </span>
            </li>
          ))}
          {failures.map((f) => (
            <li key={f.label} className="py-3 text-conflict">
              {f.label}: {f.message}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function rank(state: CheckState): number {
  return { stop: 0, warn: 1, ok: 2, info: 3 }[state];
}
