import { SWAP_SOURCES } from "./evidence";
import type { Leg, Observations } from "./model";
import { EVM_CHAINS, paysAddress } from "./sources/evm-rpc";
import { EXPLORER_BASE_URL } from "./sources/explorer";
import { assetChain, CONFIDENTIAL_TREASURY, type SwapRecord } from "./swap";

const NEARBLOCKS_TX = "https://nearblocks.io/txns/";

export function legs(obs: Observations): Leg[] {
  const primary = obs.records[0] ?? null;
  return [quoteLeg(obs, primary), depositLeg(obs, primary), settlementLeg(obs, primary), payoutLeg(obs, primary)];
}

function quoteLeg(obs: Observations, p: SwapRecord | null): Leg {
  if (!p) {
    return {
      key: "quote",
      title: "Quote",
      state: "missing",
      summary: "No NEAR Intents source has a quote for this deposit address.",
      at: null,
      links: [],
      evidenceIds: obs.evidence.filter((e) => SWAP_SOURCES.includes(e.source)).map((e) => e.id),
    };
  }
  const terms = [
    p.amountInFormatted ? `${p.amountInFormatted} ${tokenLabel(p.originAsset, obs)}` : tokenLabel(p.originAsset, obs),
    p.destinationAsset ? `to ${tokenLabel(p.destinationAsset, obs)}` : null,
    p.deadline ? `deadline ${p.deadline}` : null,
    p.refundTo ? `refunds to ${p.refundTo}` : null,
  ].filter(Boolean);
  const signed =
    obs.signature === "valid"
      ? " Signed by 1Click (signature checked)."
      : obs.signature === "absent"
        ? " No signed quote available from these sources."
        : " Signature present but not verifiable.";
  return {
    key: "quote",
    title: "Quote",
    // Only a signature check proves these are 1Click's own terms; otherwise they are as reported.
    state: obs.signature === "valid" ? "verified" : "reported",
    summary: `${terms.join(", ")}.${signed}`,
    at: p.createdAt,
    links: [{ label: "NEAR Intents explorer", href: `${EXPLORER_BASE_URL}/mask/${p.depositAddress}` }],
    evidenceIds: obs.records.map((r) => r.evidenceId),
  };
}

function depositLeg(obs: Observations, p: SwapRecord | null): Leg {
  const landed = obs.originTxs.filter((tx) => paysAddress(tx, obs.depositAddress));
  const expected = p ? assetChain(p.originAsset, obs.tokens) : null;
  const onExpected = landed.filter((tx) => tx.chain === expected);
  const elsewhere = landed.filter((tx) => tx.chain !== expected);
  const links = landed.map((tx) => ({
    label: `${EVM_CHAINS[tx.chain]?.name ?? tx.chain} tx`,
    href: `${EVM_CHAINS[tx.chain]?.explorer}/tx/${tx.txHash}`,
  }));
  const evidenceIds = [...landed.map((tx) => tx.evidence.id), ...(p ? [p.evidenceId] : [])];
  const base = { key: "deposit" as const, title: "Deposit", links, evidenceIds, at: null };

  if (elsewhere.length > 0 && (onExpected.length === 0 || !p)) {
    const chains = elsewhere.map((tx) => EVM_CHAINS[tx.chain]?.name ?? tx.chain).join(", ");
    return { ...base, state: "conflict", summary: `The deposit landed on ${chains}${expected ? `, not ${EVM_CHAINS[expected]?.name ?? expected}` : ""}.` };
  }
  if (onExpected.length > 0) {
    return { ...base, state: "verified", summary: `Deposit confirmed on ${EVM_CHAINS[expected ?? ""]?.name ?? expected}, read from the chain.` };
  }
  if (!p) return { ...base, state: "missing", summary: "No deposit found." };
  if (p.status === "PENDING_DEPOSIT") return { ...base, state: "waiting", summary: "1Click is still waiting for the deposit to arrive." };
  if (p.status === "INCOMPLETE_DEPOSIT") return { ...base, state: "conflict", summary: "1Click says the deposit arrived but is below the quoted amount." };
  if (p.depositType === "INTENTS" || p.depositType === "CONFIDENTIAL_INTENTS") {
    return { ...base, state: "reported", summary: "Deposited from a NEAR Intents balance; 1Click reports it received." };
  }
  const hashes = p.originTxHashes.length > 0 ? ` (${p.originTxHashes.length} origin tx listed, on a chain Waybill cannot read yet)` : "";
  return { ...base, state: "reported", summary: `1Click reports the deposit received${hashes}.` };
}

function settlementLeg(obs: Observations, p: SwapRecord | null): Leg {
  const base = {
    key: "settlement" as const,
    title: "Swap on NEAR Intents",
    at: null,
    links: obs.nearTxs.map((tx) => ({ label: `NEAR tx ${tx.hash.slice(0, 8)}…`, href: `${NEARBLOCKS_TX}${tx.hash}` })),
    evidenceIds: obs.nearTxs.map((tx) => tx.evidence.id),
  };
  if (!p) return { ...base, state: "not-applicable", summary: "Nothing to settle without a swap record." };
  const executed = obs.nearTxs.filter((tx) => tx.found && tx.events.some((e) => e.event === "intents_executed"));
  if (executed.length > 0) {
    const moved = executed.flatMap((tx) => tx.movements).length;
    return { ...base, state: "verified", summary: `${executed.length} settlement transaction(s) executed on intents.near, ${moved} token movement(s) read from the chain.` };
  }
  if (p.status === "PROCESSING" && p.intentHashes.length === 0) {
    return { ...base, state: "missing", summary: "No intent has been created, so no solver has executed this swap." };
  }
  if (p.status === "PROCESSING") return { ...base, state: "waiting", summary: "An intent exists; settlement has not been observed yet." };
  if (p.status === "PENDING_DEPOSIT" || p.status === "KNOWN_DEPOSIT_TX") {
    return { ...base, state: "waiting", summary: "Starts after the deposit is detected." };
  }
  if (p.status === "SUCCESS") return { ...base, state: "reported", summary: "1Click reports settlement, but no settlement transaction was available to check." };
  return { ...base, state: "not-applicable", summary: `Swap ended ${p.status}.` };
}

function payoutLeg(obs: Observations, p: SwapRecord | null): Leg {
  const refund = p?.status === "REFUNDED" || p?.status === "FAILED";
  const base = {
    key: "payout" as const,
    title: refund ? "Refund" : "Payout",
    at: p?.updatedAt ?? null,
    links: obs.destinationTxs.map((tx) => ({
      label: `${EVM_CHAINS[tx.chain]?.name ?? tx.chain} payout`,
      href: `${EVM_CHAINS[tx.chain]?.explorer}/tx/${tx.txHash}`,
    })),
    evidenceIds: obs.destinationTxs.map((tx) => tx.evidence.id),
  };
  if (!p) return { ...base, state: "not-applicable", summary: "No swap to pay out." };
  if (refund) {
    const amount = p.refundedAmountFormatted && p.refundedAmountFormatted !== "0" ? p.refundedAmountFormatted : null;
    return {
      ...base,
      state: amount ? "reported" : "missing",
      summary: amount ? `1Click reports ${amount} refunded to ${p.refundTo}.` : `Nothing refunded to ${p.refundTo ?? "the refund address"} yet.`,
    };
  }
  if (p.status !== "SUCCESS") return { ...base, state: "waiting", summary: `Waiting: swap is ${p.status}.` };

  const movements = obs.nearTxs.flatMap((tx) => tx.movements);
  if (p.recipientType === "CONFIDENTIAL_INTENTS") {
    const shielded = movements.some((m) => m.to === CONFIDENTIAL_TREASURY);
    return {
      ...base,
      state: "private",
      summary: shielded
        ? "Tokens entered the Confidential Intents treasury. Delivery to the recipient happens on the private chain."
        : "Delivered on the private chain, which public data cannot show.",
    };
  }
  if (p.recipientType === "INTENTS" && p.recipient) {
    const reached = movements.some((m) => m.to === p.recipient);
    if (reached) return { ...base, state: "verified", summary: `Tokens reached ${p.recipient} on intents.near, read from the chain.` };
    return { ...base, state: movements.length > 0 ? "conflict" : "reported", summary: movements.length > 0 ? `Settlement moved tokens, but none to ${p.recipient}.` : "1Click reports delivery inside NEAR Intents." };
  }
  const paid = obs.destinationTxs.filter((tx) => tx.found && tx.succeeded);
  if (paid.length > 0) return { ...base, state: "verified", summary: `Payout confirmed on ${EVM_CHAINS[paid[0]?.chain ?? ""]?.name}, read from the chain.` };
  if (p.destinationTxHashes.length > 0) return { ...base, state: "reported", summary: `1Click lists ${p.destinationTxHashes.length} payout transaction(s) on a chain Waybill cannot read yet.` };
  return { ...base, state: "missing", summary: "Reported SUCCESS, but no payout transaction is listed." };
}

/** "1.5 WBTC on eth"-style label from the token list; the raw asset id when the list does not have it. */
export function tokenLabel(assetId: string, obs: Pick<Observations, "tokens">): string {
  const token = obs.tokens.get(assetId);
  return token ? `${token.symbol} on ${token.blockchain}` : assetId;
}
