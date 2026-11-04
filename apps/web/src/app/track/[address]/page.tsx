import { buildCase, tokenLabel, type Finding, type Leg } from "@waybill/core";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { LEG_LABEL, LEG_TONE, TONE_TEXT, verdict } from "@/components/verdict";
import { traceSwap } from "@/lib/trace";

type Props = { params: Promise<{ address: string }>; searchParams: Promise<{ tx?: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: `Waybill · ${short(decodeURIComponent(address))}` };
}

export default async function TrackPage({ params, searchParams }: Props) {
  const address = decodeURIComponent((await params).address);
  const { tx } = await searchParams;
  const waybill = await traceSwap(address, tx);
  const { observations: obs, primary, legs, findings, failures } = waybill;
  const caseFile = buildCase(waybill);
  const stamp = verdict(waybill);
  const caseHref = `/track/${encodeURIComponent(address)}/case${tx ? `?tx=${encodeURIComponent(tx)}` : ""}`;

  return (
    <article className="space-y-8">
      <div className="sheet rounded-sm px-5 pt-9 pb-7 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-[16rem] grow basis-0 space-y-3">
            <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
              Case {caseFile.caseHash.slice(0, 12)}
            </p>
            <h1 className="text-2xl leading-snug font-semibold text-balance sm:text-3xl">
              {primary
                ? `${primary.amountInFormatted ?? ""} ${tokenLabel(primary.originAsset, obs)} → ${primary.destinationAsset ? tokenLabel(primary.destinationAsset, obs) : "?"}`
                : "No swap on record"}
            </h1>
            <dl className="grid gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">Deposit address</dt>
              <dd className="break-all">{address}</dd>
              {obs.userTxHash && (
                <>
                  <dt className="text-muted">Your deposit tx</dt>
                  <dd className="break-all">{obs.userTxHash}</dd>
                </>
              )}
              {primary?.status && (
                <>
                  <dt className="text-muted">1Click status</dt>
                  <dd>{primary.status}</dd>
                </>
              )}
              {primary?.deadline && (
                <>
                  <dt className="text-muted">Deadline</dt>
                  <dd>{formatTime(primary.deadline)}</dd>
                </>
              )}
              {primary?.refundTo && (
                <>
                  <dt className="text-muted">Refunds to</dt>
                  <dd className="break-all">{primary.refundTo}</dd>
                </>
              )}
              <dt className="text-muted">Checked</dt>
              <dd>{formatTime(obs.observedAt)}</dd>
            </dl>
          </div>
          <p className={`stamp shrink-0 px-3 py-1.5 font-mono text-lg font-semibold uppercase ${TONE_TEXT[stamp.tone]}`}>
            {stamp.word}
          </p>
        </div>

        <ol className="mt-10 space-y-0">
          {legs.map((leg, i) => (
            <LegRow key={leg.key} leg={leg} last={i === legs.length - 1} />
          ))}
        </ol>
      </div>

      {findings.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-mono text-xs tracking-[0.14em] text-muted uppercase">What the evidence shows</h2>
          <ul className="space-y-3">
            {findings.map((f) => (
              <FindingRow key={f.code + f.title} finding={f} />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3">
        <a
          href={caseHref}
          className="rounded-sm bg-ink px-5 py-3 font-mono text-sm font-medium tracking-[0.1em] text-paper uppercase transition-transform duration-150 ease-out hover:-translate-y-px"
        >
          Download case file
        </a>
        <CopyButton text={caseFile.markdown} label="Copy for GitHub or support" />
        <Link href="/" className="font-mono text-sm text-muted underline underline-offset-4 hover:text-ink">
          Trace another
        </Link>
      </section>

      <details className="group border-t border-rule pt-4">
        <summary className="cursor-pointer font-mono text-xs tracking-[0.14em] text-muted uppercase hover:text-ink">
          Evidence ({obs.evidence.length} responses{failures.length > 0 ? `, ${failures.length} source failures` : ""})
        </summary>
        <ul className="mt-4 divide-y divide-rule font-mono text-xs">
          {obs.evidence.map((e) => (
            <li key={e.id + e.url} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr_auto] sm:gap-4">
              <span className="text-muted">{e.source}</span>
              <a href={e.url} className="break-all underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                {e.label}
              </a>
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

function LegRow({ leg, last }: { leg: Leg; last: boolean }) {
  const tone = LEG_TONE[leg.state];
  return (
    <li className="relative grid grid-cols-[1.5rem_1fr] gap-x-4 pb-7 last:pb-0">
      {!last && <span aria-hidden className="absolute top-5 bottom-0 left-[0.6875rem] border-l-2 border-dashed border-rule-strong" />}
      <span
        aria-hidden
        className={`relative mt-1 size-[1.4rem] rounded-full border-2 border-current ${TONE_TEXT[tone]} ${leg.state === "verified" ? "bg-current" : "bg-paper"}`}
      />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-semibold">{leg.title}</h3>
          <span className={`font-mono text-xs tracking-[0.1em] uppercase ${TONE_TEXT[tone]}`}>
            {leg.key === "quote" && leg.state === "verified" ? "Signed by 1Click" : LEG_LABEL[leg.state]}
          </span>
        </div>
        <p className="leading-relaxed text-pretty text-muted [overflow-wrap:anywhere]">{leg.summary}</p>
        {leg.links.length > 0 && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
            {leg.links.map((link) => (
              <a key={link.href} href={link.href} className="underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                {link.label} ↗
              </a>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const tone = finding.severity === "critical" ? "conflict" : finding.severity === "warning" ? "waiting" : "reported";
  return (
    <li className={`border-l-4 border-current bg-paper px-4 py-3 ${TONE_TEXT[tone]}`}>
      <p className="font-semibold text-ink">{finding.title}</p>
      <p className="mt-1 leading-relaxed text-pretty text-muted [overflow-wrap:anywhere]">{finding.detail}</p>
      {finding.rule && (
        <p className="mt-2 font-mono text-xs text-muted">
          Documented:{" "}
          <a href={finding.rule.href} className="underline underline-offset-4 hover:text-ink">
            “{finding.rule.text}”
          </a>
        </p>
      )}
    </li>
  );
}

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
