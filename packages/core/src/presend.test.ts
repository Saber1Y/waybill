import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { preSend } from "./presend";
import { replayFetch, type Recording } from "./replay";
import type { RouteStats } from "./routes";
import { observe } from "./trace";

async function check(name: string, route: RouteStats | null = null) {
  const recording = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8")) as Recording;
  const { failures, ...obs } = await observe({ ...recording.input, fetchImpl: replayFetch(recording), now: new Date(recording.recordedAt) });
  expect(failures).toEqual([]);
  return preSend(obs, route);
}

const labels = (r: Awaited<ReturnType<typeof check>>, state: string) => r.checks.filter((c) => c.state === state).map((c) => c.label);

describe("pre-send check on real unfunded quotes", () => {
  it("gives the exact amount, chain and deadline of a fresh EXACT_INPUT quote", async () => {
    const r = await check("presend-fresh-quote");
    expect(r.instruction).toMatchObject({ qualifier: "exactly", amount: "10000", address: "0x300b11bA0B8C5a026c343893819Ac273f942E900" });
    expect(r.instruction?.token).toContain("on BNB Chain");
    expect(labels(r, "stop")).toEqual([]);
    expect(labels(r, "info")).toContain("Send on BNB Chain only");
  });

  it("warns when the deadline leaves no time for the deposit to confirm", async () => {
    const r = await check("presend-short-deadline");
    expect(r.verdict).toBe("check");
    expect(labels(r, "warn")).toEqual([expect.stringMatching(/^Only \d+ min left$/)]);
    expect(labels(r, "ok")).toContain("Terms signed by 1Click");
  });

  it("stops a quote whose deadline has passed", async () => {
    const r = await check("presend-expired-quote");
    expect(r.verdict).toBe("stop");
    expect(labels(r, "stop")).toEqual(["The quote has expired"]);
  });

  it("stops an address that was already paid", async () => {
    const r = await check("live-eth-to-tron");
    expect(r.verdict).toBe("stop");
    expect(labels(r, "stop")).toContain("This address was already used (SUCCESS)");
  });

  it("stops an address no source knows (near/intents#382)", async () => {
    const r = await check("issue-382-wrong-chain");
    expect(r.verdict).toBe("stop");
    expect(r.instruction).toBeNull();
  });

  it("warns about a route that often refunds", async () => {
    const route: RouteStats = {
      from: "tron",
      to: "eth",
      swaps: 100,
      success: 60,
      refunded: 40,
      failed: 0,
      stuck: 0,
      incomplete: 0,
      volumeUsd: 0,
      refundReasons: { NO_LIQUIDITY: 35, QUOTE_EXPIRED: 5 },
      completion: { value: 0.6, low: 0.5, high: 0.69 },
    };
    const r = await check("presend-short-deadline", route);
    const warning = r.checks.find((c) => c.label === "This route completed only 60.0% of swaps");
    expect(warning?.detail).toContain("most often NO_LIQUIDITY");
  });
});
