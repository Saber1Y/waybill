import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCase } from "./case";
import { replayFetch, type Recording } from "./replay";
import { trace } from "./trace";

function load(name: string): Recording {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8")) as Recording;
}

async function replay(name: string) {
  const recording = load(name);
  return trace({ ...recording.input, fetchImpl: replayFetch(recording), now: new Date(recording.recordedAt) });
}

const legState = (w: Awaited<ReturnType<typeof replay>>, key: string) => w.legs.find((l) => l.key === key)?.state;
const codes = (w: Awaited<ReturnType<typeof replay>>) => w.findings.map((f) => f.code);

describe("trace against recorded mainnet responses", () => {
  it("near/intents#384: SUCCESS on a confidential transfer is marked private, not verified", async () => {
    const w = await replay("issue-384-confidential");
    expect(w.failures).toEqual([]);
    expect(w.primary?.status).toBe("SUCCESS");
    expect(w.primary?.recipientType).toBe("CONFIDENTIAL_INTENTS");
    expect(legState(w, "payout")).toBe("private");
    expect(codes(w)).toContain("CONFIDENTIAL_LEG");
    // Only the explorer page knows this swap; it carries no signed quote.
    expect(w.observations.signature).toBe("absent");
    expect(legState(w, "quote")).toBe("reported");
  });

  it("near/intents#382: finds the deposit on Base although no source knows the swap", async () => {
    const w = await replay("issue-382-wrong-chain");
    expect(w.primary).toBeNull();
    expect(codes(w)).toEqual(["NO_RECORD", "WRONG_CHAIN_DEPOSIT"]);
    expect(w.findings[0]?.severity).toBe("critical");
    const deposit = w.legs.find((l) => l.key === "deposit");
    expect(deposit?.state).toBe("conflict");
    expect(deposit?.links[0]?.href).toBe(
      "https://basescan.org/tx/0x4ae0bb73e8efe79bf5a3aedeb0302371ab0d7fe0a918ebd0b1c8054a9807c593",
    );
  });

  it("verifies a live quote signature and reports the refund reason", async () => {
    const w = await replay("live-refunded-signed");
    expect(w.observations.signature).toBe("valid");
    expect(legState(w, "quote")).toBe("verified");
    expect(w.primary?.status).toBe("REFUNDED");
    expect(w.findings.find((f) => f.code === "REFUNDED")?.title).toBe("Refunded: INTENT_SUBMIT_FAILED");
    expect(legState(w, "settlement")).toBe("verified");
  });

  it("reads the Ethereum deposit and the NEAR settlement of a live swap from the chains", async () => {
    const w = await replay("live-eth-to-tron");
    expect(legState(w, "deposit")).toBe("verified");
    expect(legState(w, "settlement")).toBe("verified");
    const movements = w.observations.nearTxs.flatMap((tx) => tx.movements);
    expect(movements.length).toBeGreaterThan(0);
    expect(movements.every((m) => m.tokenId.startsWith("nep141:"))).toBe(true);
    // The USDT payout is read on Tron itself, from the TRC-20 Transfer log.
    expect(legState(w, "payout")).toBe("verified");
  });

  it.each([
    ["live-sol-to-btc", "Bitcoin", "BTC"],
    ["live-usdt-to-solana", "Solana", "USDT"],
    ["live-tron-trx", "Tron", "TRX"],
    ["live-eth-to-ton", "TON", "GRAM"],
  ])("%s: reads the payout on %s and checks recipient and token", async (name, chain, symbol) => {
    const w = await replay(name);
    expect(w.failures).toEqual([]);
    const payout = w.legs.find((l) => l.key === "payout");
    expect(payout?.state).toBe("verified");
    expect(payout?.summary).toContain(` ${symbol} reached ${w.primary?.recipient} on ${chain}`);
    expect(codes(w)).not.toContain("PAYOUT_NOT_TO_RECIPIENT");
  });

  it("reads a Solana version 1 deposit transaction", async () => {
    const w = await replay("live-sol-to-btc");
    expect(legState(w, "deposit")).toBe("verified");
  });

  it("builds a case file whose hash changes when the evidence changes", async () => {
    const w = await replay("issue-382-wrong-chain");
    const a = buildCase(w);
    expect(a.markdown).toContain("Deposit landed on Base");
    expect(a.markdown).toContain("### Requested");
    const tampered = structuredClone(w);
    const [first, ...rest] = tampered.observations.evidence;
    if (!first) throw new Error("fixture has no evidence");
    tampered.observations.evidence = [{ ...first, sha256: "0".repeat(64) }, ...rest];
    expect(buildCase(tampered).caseHash).not.toBe(a.caseHash);
  });
});
