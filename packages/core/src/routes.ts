import { gunzipSync, gzipSync } from "node:zlib";
import type { HistoryRow } from "./sources/explorer";
import type { TokenInfo } from "./sources/oneclick";
import { assetChain, type SwapStatus } from "./swap";

/**
 * A frozen sample of NEAR Intents swap history: what the Explorer API returned for one time window,
 * reduced to the fields route statistics use. Anyone with a partner JWT can collect a new one with
 * `pnpm routes:collect` and compare; the page hashes say which raw responses the sample came from.
 */
export interface RouteSnapshot {
  version: 1;
  collectedAt: string;
  /** Swaps created in [start, end). `end` sits well before `collectedAt`, so every swap had time to finish. */
  window: { start: string; end: string };
  /** Every Explorer API response the sample was built from, without credentials. */
  pages: { url: string; fetchedAt: string; httpStatus: number; sha256: string; rows: number; rejected: number }[];
  assets: SnapshotAsset[];
  swaps: SnapshotSwap[];
}

export interface SnapshotAsset {
  id: string;
  chain: string;
  symbol: string | null;
}

export interface SnapshotSwap {
  /** Creation time, Unix seconds. */
  t: number;
  s: SwapStatus;
  /** Indexes into `assets`. */
  o: number;
  d: number;
  usd: number | null;
  /** Refund reason, when refunded. */
  r?: string;
  /** Deposit address (and memo), kept only for swaps that did not succeed so each one can be traced. */
  id?: string;
}

/** Turns Explorer API rows into a snapshot. Pure; the collector does the fetching. */
export function buildSnapshot(input: {
  collectedAt: Date;
  start: Date;
  end: Date;
  pages: RouteSnapshot["pages"];
  rows: HistoryRow[];
  tokens: Map<string, TokenInfo>;
}): RouteSnapshot {
  const assets: SnapshotAsset[] = [];
  const index = new Map<string, number>();
  const assetIndex = (id: string): number => {
    let i = index.get(id);
    if (i === undefined) {
      i = assets.length;
      index.set(id, i);
      assets.push({ id, chain: assetChain(id, input.tokens), symbol: input.tokens.get(id)?.symbol ?? null });
    }
    return i;
  };
  const seen = new Set<string>();
  const swaps: SnapshotSwap[] = [];
  for (const row of input.rows) {
    // Pages can overlap when new swaps arrive mid-collection; each swap counts once.
    if (seen.has(row.depositAddressAndMemo)) continue;
    seen.add(row.depositAddressAndMemo);
    const usd = row.amountInUsd == null ? null : Number(row.amountInUsd);
    swaps.push({
      t: row.createdAtTimestamp,
      s: row.status,
      o: assetIndex(row.originAsset),
      d: assetIndex(row.destinationAsset),
      usd: usd !== null && Number.isFinite(usd) ? Math.round(usd * 100) / 100 : null,
      ...(row.refundReason ? { r: row.refundReason } : {}),
      ...(row.status === "SUCCESS" ? {} : { id: row.depositAddressAndMemo }),
    });
  }
  swaps.sort((a, b) => b.t - a.t);
  return {
    version: 1,
    collectedAt: input.collectedAt.toISOString(),
    window: { start: input.start.toISOString(), end: input.end.toISOString() },
    pages: input.pages,
    assets,
    swaps,
  };
}

export interface Rate {
  /** Share of swaps, 0 to 1. */
  value: number;
  /** 95% Wilson score interval, so a route with ten swaps does not look as certain as one with ten thousand. */
  low: number;
  high: number;
}

export interface Outcomes {
  /** Swaps whose deposit arrived. */
  swaps: number;
  success: number;
  refunded: number;
  failed: number;
  /** Still PROCESSING when collected, though created hours earlier. */
  stuck: number;
  /** The user sent less than the quote asked for. Counted apart: the route did not fail them. */
  incomplete: number;
  volumeUsd: number;
  refundReasons: Record<string, number>;
  /** Success share of complete deposits; null below `MIN_SWAPS_FOR_RATE`. */
  completion: Rate | null;
}

export interface RouteStats extends Outcomes {
  from: string;
  to: string;
}

export interface ProblemSwap {
  id: string;
  status: SwapStatus;
  from: string;
  to: string;
  fromSymbol: string | null;
  toSymbol: string | null;
  createdAt: string;
  usd: number | null;
  refundReason: string | null;
}

export interface RouteReport {
  overall: Outcomes;
  routes: RouteStats[];
  /** Stuck and failed swaps, newest first: each can be opened in the tracker. */
  problems: ProblemSwap[];
  /** Hours between the window's end and collection: the least time any counted swap had to finish. */
  settleHours: number;
}

/** Below this many complete deposits a route shows counts but no rate. */
export const MIN_SWAPS_FOR_RATE = 30;

export function routeReport(snapshot: RouteSnapshot): RouteReport {
  const overall = emptyOutcomes();
  const byRoute = new Map<string, RouteStats>();
  const problems: ProblemSwap[] = [];
  for (const swap of snapshot.swaps) {
    const origin = snapshot.assets[swap.o];
    const destination = snapshot.assets[swap.d];
    if (!origin || !destination) throw new Error(`Snapshot swap points at a missing asset (${swap.o}, ${swap.d})`);
    const key = `${origin.chain}>${destination.chain}`;
    let route = byRoute.get(key);
    if (!route) {
      route = { from: origin.chain, to: destination.chain, ...emptyOutcomes() };
      byRoute.set(key, route);
    }
    count(overall, swap);
    count(route, swap);
    if ((swap.s === "PROCESSING" || swap.s === "FAILED") && swap.id) {
      problems.push({
        id: swap.id,
        status: swap.s,
        from: origin.chain,
        to: destination.chain,
        fromSymbol: origin.symbol,
        toSymbol: destination.symbol,
        createdAt: new Date(swap.t * 1000).toISOString(),
        usd: swap.usd,
        refundReason: swap.r ?? null,
      });
    }
  }
  const routes = [...byRoute.values()];
  for (const outcome of [overall, ...routes]) outcome.completion = completion(outcome);
  routes.sort((a, b) => b.swaps - a.swaps || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const settleHours = (Date.parse(snapshot.collectedAt) - Date.parse(snapshot.window.end)) / 3_600_000;
  return { overall, routes, problems, settleHours };
}

function emptyOutcomes(): Outcomes {
  return { swaps: 0, success: 0, refunded: 0, failed: 0, stuck: 0, incomplete: 0, volumeUsd: 0, refundReasons: {}, completion: null };
}

function count(outcome: Outcomes, swap: SnapshotSwap): void {
  outcome.swaps++;
  if (swap.usd !== null) outcome.volumeUsd += swap.usd;
  switch (swap.s) {
    case "SUCCESS":
      outcome.success++;
      break;
    case "REFUNDED":
      outcome.refunded++;
      if (swap.r) outcome.refundReasons[swap.r] = (outcome.refundReasons[swap.r] ?? 0) + 1;
      break;
    case "FAILED":
      outcome.failed++;
      break;
    case "PROCESSING":
      outcome.stuck++;
      break;
    case "INCOMPLETE_DEPOSIT":
      outcome.incomplete++;
      break;
    default:
      // KNOWN_DEPOSIT_TX and PENDING_DEPOSIT are not requested from the API; count them as in flight.
      outcome.stuck++;
  }
}

function completion(outcome: Outcomes): Rate | null {
  const n = outcome.swaps - outcome.incomplete;
  return n >= MIN_SWAPS_FOR_RATE ? wilson(outcome.success, n) : null;
}

/** 95% Wilson score interval for `successes` out of `n`. */
export function wilson(successes: number, n: number): Rate {
  if (n <= 0) return { value: 0, low: 0, high: 1 };
  const z = 1.96;
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { value: p, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

/** Snapshots are stored gzipped: a day of history is about 25,000 swaps. */
export function encodeSnapshot(snapshot: RouteSnapshot): Buffer {
  return gzipSync(`${JSON.stringify(snapshot)}\n`, { level: 9 });
}

export function decodeSnapshot(data: Buffer): RouteSnapshot {
  const snapshot = JSON.parse(gunzipSync(data).toString("utf8")) as RouteSnapshot;
  if (snapshot.version !== 1) throw new Error(`Unsupported route snapshot version ${String(snapshot.version)}`);
  return snapshot;
}
