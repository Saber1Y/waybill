import { MIN_SWAPS_FOR_RATE, type Outcomes, type Rate, type RouteStats } from "@waybill/core";
import type { Metadata } from "next";
import Link from "next/link";
import { chainName } from "@/components/chains";
import { loadRouteReport, SNAPSHOT_PATH } from "@/lib/routes";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Waybill · Route reliability",
  description: "How often NEAR Intents swaps complete, per chain route, from a full day of Explorer API history.",
};

/** Routes shown in the table; the rest are summed in one line so nothing is hidden. */
const TOP_ROUTES = 24;

/**
 * Left edge of the shared rate scale. Most routes sit between 98% and 100%, so a scale that
 * reached down to the weakest route would squash them all into one point; a rate below this is
 * pinned to the edge and printed in red instead.
 */
const SCALE_MIN = 0.9;

export default async function RoutesPage() {
  const loaded = await loadRouteReport();
  if (!loaded) return <NoSnapshot />;
  const { snapshot, report } = loaded;
  const { overall, routes, problems } = report;
  const rated = routes.filter((r) => r.completion);
  const shown = routes.slice(0, TOP_ROUTES);
  const rest = routes.slice(TOP_ROUTES);
  const restSwaps = rest.reduce((sum, r) => sum + r.swaps, 0);
  const weakest = [...rated].sort((a, b) => (a.completion?.high ?? 1) - (b.completion?.high ?? 1)).slice(0, 3);
  const reasons = Object.entries(overall.refundReasons).sort((a, b) => b[1] - a[1]);

  return (
    <article className="space-y-12">
      <header className="max-w-2xl space-y-4">
        <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Route reliability</p>
        <h1 className="text-3xl leading-tight font-semibold text-balance sm:text-4xl">
          Do NEAR Intents swaps arrive?
        </h1>
        <p className="text-lg leading-relaxed text-pretty text-muted">
          Every swap the Explorer API lists for one day, counted by what happened to it. Each rate carries a 95% interval,
          so a route with forty swaps does not look as certain as one with four thousand.
        </p>
      </header>

      <section className="sheet rounded-sm px-5 pt-9 pb-7 sm:px-8" aria-labelledby="tally">
        <h2 id="tally" className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
          {formatWindow(snapshot.window.start, snapshot.window.end)}
        </h2>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-sm text-muted">Completed</dt>
            <dd className="mt-1 font-mono text-4xl font-semibold tracking-tight text-verified sm:text-5xl">
              {overall.completion ? percent(overall.completion.value, 2) : "–"}
            </dd>
            {overall.completion && (
              <dd className="mt-1 font-mono text-xs text-muted">
                95% interval {percent(overall.completion.low, 2)} to {percent(overall.completion.high, 2)}
              </dd>
            )}
          </div>
          <Tally label="Swaps" value={number(overall.swaps)} note={`${usd(overall.volumeUsd)} in`} />
          <Tally label="Refunded" value={number(overall.refunded)} note={share(overall.refunded, overall)} tone="text-reported" />
          <Tally
            label="Stuck or failed"
            value={number(overall.stuck + overall.failed)}
            note={`${number(overall.stuck)} processing, ${number(overall.failed)} failed`}
            tone={overall.stuck + overall.failed > 0 ? "text-conflict" : undefined}
          />
        </dl>
        <OutcomeBar outcome={overall} />
        <p className="mt-4 font-mono text-xs leading-relaxed text-muted">
          {number(overall.incomplete)} more deposits were smaller than their quote asked for. They are shown apart and left
          out of the rate: the sender came up short, not the route.
        </p>
      </section>

      {weakest.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Least reliable, with enough swaps to say so</h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {weakest.map((r) => (
              <li key={r.from + r.to} className="border-l-4 border-waiting bg-paper px-4 py-3">
                <p className="font-semibold">
                  {chainName(r.from)} → {chainName(r.to)}
                </p>
                <p className="mt-1 font-mono text-sm text-muted">
                  {r.completion && `${percent(r.completion.value, 1)} of ${number(r.swaps - r.incomplete)}`}
                </p>
                <p className="mt-1 text-sm text-pretty text-muted">{mainLoss(r)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="routes">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="routes" className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
            Busiest {shown.length} of {routes.length} routes
          </h2>
          <p className="hidden font-mono text-xs text-muted sm:block">
            Scale {percent(SCALE_MIN, 0)} to 100% · rate shown from {MIN_SWAPS_FOR_RATE} swaps
          </p>
        </div>
        <div className="sheet overflow-x-auto rounded-sm">
          <table className="w-full border-collapse text-sm sm:min-w-[40rem]">
            <thead>
              <tr className="border-b border-rule-strong text-left font-mono text-xs tracking-[0.08em] text-muted uppercase">
                <th scope="col" className="py-3 pr-3 pl-5 font-medium sm:pl-6">Route</th>
                <th scope="col" className="px-2 py-3 text-right font-medium sm:px-3">Swaps</th>
                <th scope="col" className="px-2 py-3 text-right font-medium sm:w-[34%] sm:px-3 sm:text-left">
                  <span className="sm:hidden">Done</span>
                  <span className="hidden sm:inline">Completed</span>
                </th>
                <th scope="col" className="hidden px-3 py-3 text-right font-medium sm:table-cell">Refunded</th>
                <th scope="col" className="py-3 pr-5 pl-2 text-right font-medium whitespace-nowrap sm:pr-6 sm:pl-3">
                  <span className="sm:hidden">Issues</span>
                  <span className="hidden sm:inline">Stuck · failed</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {shown.map((r) => (
                <RouteRow key={r.from + r.to} route={r} />
              ))}
            </tbody>
            {rest.length > 0 && (
              <tfoot>
                <tr className="border-t border-rule-strong font-mono text-xs text-muted">
                  <td colSpan={5} className="px-5 py-3 sm:px-6">
                    {rest.length} smaller routes, {number(restSwaps)} swaps in all, are counted in the totals above.
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {reasons.length > 0 && (
        <section className="space-y-3" aria-labelledby="reasons">
          <h2 id="reasons" className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
            Why {number(overall.refunded)} swaps were refunded
          </h2>
          <ul className="space-y-2">
            {reasons.map(([reason, n]) => (
              <li key={reason} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 font-mono text-xs">
                <span className="truncate">{reason}</span>
                <span className="h-2 rounded-full bg-paper-2">
                  <span className="block h-2 rounded-full bg-reported" style={{ width: `${(n / overall.refunded) * 100}%` }} />
                </span>
                <span className="text-muted">{number(n)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="problems">
        <h2 id="problems" className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
          Stuck and failed swaps, open any one
        </h2>
        {problems.length === 0 ? (
          <p className="text-muted">None in this window.</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {problems.slice(0, 40).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/track/${encodeURIComponent(p.id)}`}
                  className="group grid gap-1 py-3 sm:grid-cols-[6.5rem_1fr_auto] sm:items-baseline sm:gap-4"
                >
                  <span className={`font-mono text-xs tracking-[0.1em] uppercase ${p.status === "FAILED" ? "text-conflict" : "text-waiting"}`}>
                    {p.status === "FAILED" ? "Failed" : "Processing"}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">
                      {p.fromSymbol ?? "?"} on {chainName(p.from)} → {p.toSymbol ?? "?"} on {chainName(p.to)}
                    </span>
                    <span className="block font-mono text-xs break-all text-muted underline decoration-rule-strong underline-offset-4 group-hover:decoration-ink">
                      {p.id}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {p.usd === null ? "" : `${usd(p.usd)} · `}
                    {formatTime(p.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {problems.length > 40 && <p className="font-mono text-xs text-muted">Showing the newest 40 of {problems.length}.</p>}
      </section>

      <details className="border-t border-rule pt-4">
        <summary className="cursor-pointer font-mono text-xs tracking-[0.14em] text-muted uppercase hover:text-ink">
          Method and evidence ({snapshot.pages.length} API responses)
        </summary>
        <div className="mt-4 max-w-2xl space-y-3 leading-relaxed text-pretty text-muted">
          <p>
            Source: the NEAR Intents Explorer API, every swap whose deposit arrived (statuses SUCCESS, REFUNDED, FAILED,
            PROCESSING and INCOMPLETE_DEPOSIT) created in the window. Quotes nobody funded are left out.
          </p>
          <p>
            The window closed {hours(report.settleHours)} before collection on {formatTime(snapshot.collectedAt)}, so a swap
            still PROCESSING had at least that long to finish. That is what &ldquo;stuck&rdquo; means here.
          </p>
          <p>
            Not measured: how long swaps take, because the API gives a creation time but no completion time. Not included:
            Confidential Intents swaps, which the API does not list (near/intents#384 is on the public explorer page but
            absent from the API).
          </p>
          <p>
            Re-run it with a partner key: <code className="font-mono text-ink">pnpm routes:collect</code> writes{" "}
            <code className="font-mono text-ink">{SNAPSHOT_PATH}</code>, and this page is built from that file.
          </p>
        </div>
        <ul className="mt-4 divide-y divide-rule font-mono text-xs">
          {snapshot.pages.map((page, i) => (
            <li key={page.sha256 + i} className="grid gap-1 py-2 sm:grid-cols-[3rem_1fr_auto] sm:gap-4">
              <span className="text-muted">#{i + 1}</span>
              <span className="break-all text-muted">{page.url.replace("https://explorer.near-intents.org", "")}</span>
              <span className="text-muted">
                {page.rows} rows · {page.sha256.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function Tally({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-2xl font-semibold tracking-tight sm:text-3xl ${tone ?? ""}`}>{value}</dd>
      <dd className="mt-1 font-mono text-xs text-muted">{note}</dd>
    </div>
  );
}

/** One strip, every complete deposit: green delivered, blue refunded, red stuck or failed. */
function OutcomeBar({ outcome }: { outcome: Outcomes }) {
  const n = outcome.swaps - outcome.incomplete;
  if (n === 0) return null;
  const parts = [
    { key: "success", value: outcome.success, className: "bg-verified" },
    { key: "refunded", value: outcome.refunded, className: "bg-reported" },
    { key: "stuck", value: outcome.stuck + outcome.failed, className: "bg-conflict" },
  ];
  return (
    <div className="mt-7 flex h-3 overflow-hidden rounded-full bg-paper-2" aria-hidden>
      {parts.map((p) => (
        // A one-swap share still gets a visible sliver.
        <span key={p.key} className={p.className} style={{ width: `${(p.value / n) * 100}%`, minWidth: p.value > 0 ? 3 : 0 }} />
      ))}
    </div>
  );
}

function RouteRow({ route }: { route: RouteStats }) {
  return (
    <tr>
      <th scope="row" className="py-3 pr-3 pl-5 text-left font-medium sm:pl-6">
        {chainName(route.from)} <span className="text-muted">→</span> {chainName(route.to)}
      </th>
      <td className="px-2 py-3 text-right font-mono sm:px-3">{number(route.swaps)}</td>
      <td className="px-2 py-3 sm:px-3">
        {route.completion ? (
          <Interval rate={route.completion} />
        ) : (
          <span className="block text-right font-mono text-xs text-muted sm:text-left">too few</span>
        )}
      </td>
      <td className="hidden px-3 py-3 text-right font-mono text-muted sm:table-cell">{route.refunded ? number(route.refunded) : "·"}</td>
      <td className={`py-3 pr-5 pl-3 text-right font-mono sm:pr-6 ${route.stuck + route.failed ? "text-conflict" : "text-muted"}`}>
        <span className="sm:hidden">{route.stuck + route.failed || "·"}</span>
        <span className="hidden whitespace-nowrap sm:inline">{route.stuck + route.failed ? `${route.stuck} · ${route.failed}` : "·"}</span>
      </td>
    </tr>
  );
}

/** A dot for the rate and a bar for its 95% interval, on a shared scale so routes compare at a glance. */
function Interval({ rate }: { rate: Rate }) {
  const at = (v: number) => `${((Math.max(v, SCALE_MIN) - SCALE_MIN) / (1 - SCALE_MIN)) * 100}%`;
  const offScale = rate.value < SCALE_MIN;
  return (
    <div className="flex items-center justify-end gap-3">
      <span className="relative hidden h-4 min-w-24 grow sm:block" aria-hidden>
        <span className="absolute inset-x-0 top-1/2 border-t border-rule" />
        {offScale ? (
          <span className="absolute top-1/2 left-0 -translate-y-1/2 font-mono text-xs leading-none text-conflict">
            ◂ below {percent(SCALE_MIN, 0)}
          </span>
        ) : (
          <>
            <span
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-verified/30"
              style={{ left: at(rate.low), right: `calc(100% - ${at(rate.high)})` }}
            />
            <span
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-verified"
              style={{ left: at(rate.value) }}
            />
          </>
        )}
      </span>
      <span
        className={`w-14 shrink-0 text-right font-mono text-xs ${offScale ? "text-conflict" : ""}`}
        title={`95% interval ${percent(rate.low, 1)} to ${percent(rate.high, 1)}`}
      >
        {percent(rate.value, 1)}
      </span>
    </div>
  );
}

function NoSnapshot() {
  return (
    <div className="sheet max-w-2xl space-y-3 rounded-sm px-5 pt-9 pb-7 sm:px-8">
      <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Route reliability</p>
      <p className="leading-relaxed text-muted">
        No snapshot yet. Run <code className="font-mono text-ink">pnpm routes:collect</code> with a partner key, then rebuild.
      </p>
    </div>
  );
}

/** What a weak route mostly loses swaps to, in words. */
function mainLoss(route: RouteStats): string {
  const stuck = route.stuck + route.failed;
  const [reason, n] = Object.entries(route.refundReasons).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (stuck > route.refunded) return `${stuck} stuck or failed.`;
  if (reason && n) return `${route.refunded} refunded, ${n} of them ${reason}.`;
  return `${route.refunded} refunded.`;
}

function share(n: number, outcome: Outcomes): string {
  const base = outcome.swaps - outcome.incomplete;
  return base ? `${percent(n / base, 2)} of swaps` : "";
}

function percent(v: number, digits: number): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function number(n: number): string {
  return n.toLocaleString("en-US");
}

function usd(n: number): string {
  if (n < 1) return "under $1";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000).toLocaleString("en-US")}k`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function hours(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hours`;
}

function formatTime(iso: string): string {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function formatWindow(start: string, end: string): string {
  return `${formatTime(start)} to ${formatTime(end)}`;
}
