import { describe, expect, it } from "vitest";
import type { Observations } from "./model";
import type { ChainTx } from "./sources/chains";
import { findings } from "./rules";
import type { SwapRecord } from "./swap";

// The shape reported in near/intents#399 (WBTC on Ethereum to BTC, PROCESSING since 13 Oct with no
// intent). Its deposit address is not public, so the record is rebuilt from the issue text.
const issue399: SwapRecord = {
  evidenceId: "oneclick-status:issue399",
  depositAddress: "0x0000000000000000000000000000000000000399",
  depositMemo: null,
  status: "PROCESSING",
  createdAt: "2026-10-13T07:32:25.000Z",
  updatedAt: "2026-10-13T07:40:00.000Z",
  originAsset: "nep141:eth-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.omft.near",
  destinationAsset: "nep141:btc.omft.near",
  amountInFormatted: "1.5",
  amountInUsd: null,
  amountOutFormatted: null,
  depositType: "ORIGIN_CHAIN",
  recipient: "bc1qexample",
  recipientType: "DESTINATION_CHAIN",
  refundTo: "0x00000000000000000000000000000000000000aa",
  refundType: "ORIGIN_CHAIN",
  deadline: "2026-10-16T07:32:25.000Z",
  intentHashes: [],
  nearTxHashes: [],
  originTxHashes: [],
  destinationTxHashes: [],
  refundedAmountFormatted: "0",
  refundReason: null,
  signedQuote: null,
};

function observations(record: SwapRecord, observedAt: string, extra: Partial<Observations> = {}): Observations {
  return {
    depositAddress: record.depositAddress,
    userTxHash: null,
    observedAt,
    records: [record],
    signature: "absent",
    nearTxs: [],
    originTxs: [],
    destinationTxs: [],
    tokens: new Map(),
    evidence: [],
    ...extra,
  };
}

describe("rules", () => {
  it("flags #399: PROCESSING with no intent and the deadline long gone", () => {
    const found = findings(observations(issue399, "2026-11-02T12:00:00.000Z"));
    expect(found.map((f) => f.code)).toEqual(["PROCESSING_WITHOUT_INTENT", "DEADLINE_PASSED_UNRESOLVED"]);
    expect(found[0]?.title).toBe("PROCESSING for 20 days with no intent created");
    expect(found[1]?.title).toBe("Quote deadline passed 17 days ago with no payout or refund");
    expect(found.every((f) => f.severity === "critical")).toBe(true);
  });

  it("does not flag PROCESSING within the grace period", () => {
    expect(findings(observations(issue399, "2026-10-13T07:50:00.000Z"))).toEqual([]);
  });

  it("does not flag a deadline once the swap is terminal", () => {
    const refunded = { ...issue399, status: "REFUNDED" as const, refundedAmountFormatted: "1.4999" };
    expect(findings(observations(refunded, "2026-11-02T12:00:00.000Z")).map((f) => f.code)).toEqual(["REFUNDED"]);
  });

  it("reports sources that disagree on status", () => {
    const page = { ...issue399, evidenceId: "explorer-page:x", status: "SUCCESS" as const };
    const obs = observations(issue399, "2026-10-13T07:50:00.000Z", { records: [issue399, page] });
    expect(findings(obs).map((f) => f.code)).toEqual(["SOURCES_DISAGREE"]);
  });

  it("catches SUCCESS where settlement paid someone other than the INTENTS recipient", () => {
    const success: SwapRecord = { ...issue399, status: "SUCCESS", recipientType: "INTENTS", recipient: "alice.near" };
    const obs = observations(success, "2026-10-13T08:00:00.000Z", {
      nearTxs: [
        {
          hash: "h",
          evidence: { id: "near-rpc:h" } as Observations["evidence"][number],
          found: true,
          signer: "intents.near",
          receiver: "intents.near",
          methods: ["execute_intents"],
          succeeded: true,
          events: [],
          movements: [{ kind: "transfer", from: "solver.near", to: "mallory.near", tokenId: "nep141:btc.omft.near", amount: "1" }],
        },
      ],
    });
    const found = findings(obs);
    expect(found.map((f) => f.code)).toEqual(["PAID_TO_OTHER_ACCOUNT"]);
    expect(found[0]?.detail).toContain("mallory.near");
  });

  it("catches SUCCESS whose Bitcoin payout went to another address", () => {
    const success: SwapRecord = { ...issue399, status: "SUCCESS", recipient: "bc1qrecipient", destinationTxHashes: ["ab".repeat(32)] };
    const payout: ChainTx = {
      chain: "btc",
      txHash: "ab".repeat(32),
      evidence: { id: "btc-api:x" } as Observations["evidence"][number],
      found: true,
      succeeded: true,
      block: 1,
      at: null,
      transfers: [{ to: "bc1qsomeoneelse", asset: "native", amount: 1000n }],
    };
    const found = findings(observations(success, "2026-10-13T08:00:00.000Z", { destinationTxs: [payout] }));
    expect(found.map((f) => f.code)).toEqual(["PAYOUT_NOT_TO_RECIPIENT"]);
    expect(found[0]?.detail).toContain("bc1qrecipient");

    // The same transaction paying the recipient (bech32 is case-insensitive) raises nothing.
    const paid = { ...payout, transfers: [{ to: "bc1qrecipient", asset: "native", amount: 1000n }] };
    const ok = { ...success, recipient: "BC1QRECIPIENT" };
    expect(findings(observations(ok, "2026-10-13T08:00:00.000Z", { destinationTxs: [paid] }))).toEqual([]);
  });
});
