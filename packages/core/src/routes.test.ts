import { describe, expect, it } from "vitest";
import { buildSnapshot, decodeSnapshot, encodeSnapshot, MIN_SWAPS_FOR_RATE, routeReport, wilson } from "./routes";
import type { HistoryRow } from "./sources/explorer";
import type { TokenInfo } from "./sources/oneclick";

const ETH_USDT = "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near";
const TRON_USDT = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";
const BTC = "nep141:btc.omft.near";
const tokens = new Map<string, TokenInfo>([
  [ETH_USDT, { assetId: ETH_USDT, symbol: "USDT", blockchain: "eth", decimals: 6 }],
  [TRON_USDT, { assetId: TRON_USDT, symbol: "USDT", blockchain: "tron", decimals: 6 }],
]);

let serial = 0;
function row(status: HistoryRow["status"], origin: string, destination: string, extra: Partial<HistoryRow> = {}): HistoryRow {
  serial++;
  return {
    depositAddressAndMemo: `addr-${serial}`,
    status,
    createdAtTimestamp: 1_794_000_000 + serial,
    originAsset: origin,
    destinationAsset: destination,
    amountInUsd: "10.004",
    ...extra,
  };
}

function snapshot(rows: HistoryRow[]) {
  return buildSnapshot({
    collectedAt: new Date("2026-11-07T14:00:00Z"),
    start: new Date("2026-11-06T12:00:00Z"),
    end: new Date("2026-11-07T12:00:00Z"),
    pages: [],
    rows,
    tokens,
  });
}

describe("wilson", () => {
  it("matches the textbook interval", () => {
    const half = wilson(50, 100);
    expect(half.low).toBeCloseTo(0.4038, 3);
    expect(half.high).toBeCloseTo(0.5962, 3);
    // No successes is not a certain zero: ten tries still leave room up to about 28%.
    expect(wilson(0, 10).high).toBeCloseTo(0.2775, 3);
  });
});

describe("route snapshot and report", () => {
  it("groups swaps by chain pair and keeps addresses only for swaps that did not succeed", () => {
    const rows = [
      ...Array.from({ length: 40 }, () => row("SUCCESS", ETH_USDT, TRON_USDT)),
      row("REFUNDED", ETH_USDT, TRON_USDT, { refundReason: "NO_LIQUIDITY" }),
      row("PROCESSING", ETH_USDT, TRON_USDT),
      row("INCOMPLETE_DEPOSIT", ETH_USDT, TRON_USDT),
      row("FAILED", BTC, TRON_USDT),
    ];
    const snap = snapshot(rows);
    expect(snap.swaps.filter((s) => s.id).map((s) => s.s).sort()).toEqual(["FAILED", "INCOMPLETE_DEPOSIT", "PROCESSING", "REFUNDED"]);
    // Assets missing from the token list still resolve their chain from the asset id.
    expect(snap.assets.find((a) => a.id === BTC)).toEqual({ id: BTC, chain: "btc", symbol: null });

    const report = routeReport(snap);
    const ethTron = report.routes.find((r) => r.from === "eth" && r.to === "tron");
    expect(ethTron).toMatchObject({ swaps: 43, success: 40, refunded: 1, stuck: 1, incomplete: 1, refundReasons: { NO_LIQUIDITY: 1 } });
    // Incomplete deposits are the sender's shortfall, so the rate is 40 of 42, not 40 of 43.
    expect(ethTron?.completion?.value).toBeCloseTo(40 / 42, 6);
    expect(ethTron?.volumeUsd).toBeCloseTo(43 * 10, 6);
    expect(report.routes.find((r) => r.from === "btc")?.completion).toBeNull();
    expect(report.problems.map((p) => p.status).sort()).toEqual(["FAILED", "PROCESSING"]);
    expect(report.settleHours).toBe(2);
  });

  it("counts a swap once when pages overlap", () => {
    const repeated = row("SUCCESS", ETH_USDT, TRON_USDT);
    expect(snapshot([repeated, repeated]).swaps).toHaveLength(1);
  });

  it("shows no rate below the minimum sample", () => {
    const rows = Array.from({ length: MIN_SWAPS_FOR_RATE - 1 }, () => row("SUCCESS", ETH_USDT, TRON_USDT));
    expect(routeReport(snapshot(rows)).overall.completion).toBeNull();
  });

  it("round-trips through the gzip encoding", () => {
    const snap = snapshot([row("REFUNDED", ETH_USDT, TRON_USDT, { refundReason: "QUOTE_EXPIRED" })]);
    expect(decodeSnapshot(encodeSnapshot(snap))).toEqual(snap);
  });
});
