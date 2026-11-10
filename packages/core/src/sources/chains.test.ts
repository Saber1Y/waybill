import { describe, expect, it } from "vitest";
import { normalizeAddress, paidTo, tonRawAddress, type ChainTx } from "./chains";
import { tronAddress } from "./tron";

describe("chain addresses", () => {
  it("encodes Tron hex addresses as base58check", () => {
    // USDT's TRC-20 contract, as TronGrid logs it and as the 1Click token list names it.
    expect(tronAddress("41a614f803b6fd780986a42c78ec9c7f77e6ded13c")).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
  });

  it("reads TON user-friendly addresses as raw workchain:hash", () => {
    // A real payout recipient and the account toncenter reports for the same wallet.
    expect(tonRawAddress("UQAIyacWfJ7RfKQ-XNem7y_M0uBwJxyRCz78nm8XLNkMMwRh")).toBe(
      "0:08C9A7167C9ED17CA43E5CD7A6EF2FCCD2E070271C910B3EFC9E6F172CD90C33",
    );
    expect(tonRawAddress("0:08c9a7167c9ed17ca43e5cd7a6ef2fccd2e070271c910b3efc9e6f172cd90c33")).toBe(
      "0:08C9A7167C9ED17CA43E5CD7A6EF2FCCD2E070271C910B3EFC9E6F172CD90C33",
    );
    expect(tonRawAddress("not-an-address")).toBeNull();
  });

  it("only folds case where the address format is case-insensitive", () => {
    expect(normalizeAddress("eth", "0xAbC0000000000000000000000000000000000001")).toBe("0xabc0000000000000000000000000000000000001");
    expect(normalizeAddress("btc", "BC1QABC")).toBe("bc1qabc");
    expect(normalizeAddress("sol", "7u3Mx9kYg8rx9v36avnWbHK3sd7qGyEuREwFX6jQEBpC")).toBe("7u3Mx9kYg8rx9v36avnWbHK3sd7qGyEuREwFX6jQEBpC");
  });
});

describe("paidTo", () => {
  const tx: ChainTx = {
    chain: "sol",
    txHash: "sig",
    evidence: { id: "sol-rpc:x" } as ChainTx["evidence"],
    found: true,
    succeeded: true,
    block: 1,
    at: null,
    transfers: [
      { to: "alice", asset: "native", amount: 5n },
      { to: "alice", asset: "USDTmint", amount: 7n },
      { to: "alice", asset: "USDTmint", amount: 3n },
    ],
  };

  it("sums what one recipient got in one asset", () => {
    expect(paidTo(tx, "alice", "USDTmint")).toEqual({ amount: 10n });
    expect(paidTo(tx, "alice", "OTHERmint")).toBeNull();
    expect(paidTo(tx, "bob")).toBeNull();
  });

  it("counts nothing from a failed transaction", () => {
    expect(paidTo({ ...tx, succeeded: false }, "alice", "native")).toBeNull();
  });
});
