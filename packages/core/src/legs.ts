import { SWAP_SOURCES } from "./evidence";
import type { Leg, Observations } from "./model";
import type { TokenInfo } from "./sources/oneclick";
import { CHAIN_INFO, chainAsset, chainLabel, paidTo, type ChainTx } from "./sources/chains";
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
  const landed = obs.originTxs.filter((tx) => paidTo(tx, obs.depositAddress));
  const expected = p ? assetChain(p.originAsset, obs.tokens) : null;
  const onExpected = landed.filter((tx) => tx.chain === expected);
  const elsewhere = landed.filter((tx) => tx.chain !== expected);
  const links = landed.map((tx) => txLink(tx, "tx"));
  const evidenceIds = [...landed.map((tx) => tx.evidence.id), ...(p ? [p.evidenceId] : [])];
  const base = { key: "deposit" as const, title: "Deposit", links, evidenceIds, at: null };

  if (elsewhere.length > 0 && (onExpected.length === 0 || !p)) {
    const chains = elsewhere.map((tx) => chainLabel(tx.chain)).join(", ");
    return { ...base, state: "conflict", summary: `The deposit landed on ${chains}${expected ? `, not ${chainLabel(expected)}` : ""}.` };
  }
  if (onExpected.length > 0) {
    return { ...base, state: "verified", summary: `Deposit confirmed on ${chainLabel(expected ?? "")}, read from the chain.` };
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
    links: obs.destinationTxs.map((tx) => txLink(tx, "payout")),
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
  const check = payoutCheck(obs, p);
  if (check.paid) {
    const amount = check.paid.amount === null ? "Tokens" : formatAmount(check.paid.amount, check.token);
    return { ...base, state: "verified", summary: `${amount} reached ${p.recipient} on ${chainLabel(check.chain)}, read from the chain.` };
  }
  if (check.unpaid.length > 0) {
    return { ...base, state: "conflict", summary: `The listed payout transaction on ${chainLabel(check.chain)} did not pay ${p.recipient}${check.token ? ` in ${check.token.symbol}` : ""}.` };
  }
  if (check.pending.length > 0) return { ...base, state: "waiting", summary: `The payout transaction on ${chainLabel(check.chain)} is not final yet.` };
  if (check.absent.length > 0) return { ...base, state: "missing", summary: `1Click lists a payout transaction that ${chainLabel(check.chain)} does not have.` };
  if (p.destinationTxHashes.length > 0) return { ...base, state: "reported", summary: `1Click lists ${p.destinationTxHashes.length} payout transaction(s) on a chain Waybill cannot read yet.` };
  return { ...base, state: "missing", summary: "Reported SUCCESS, but no payout transaction is listed." };
}

export interface PayoutCheck {
  chain: string;
  token: TokenInfo | undefined;
  /** What the listed transactions delivered to the recipient, in the quoted token. */
  paid: { amount: bigint | null } | null;
  /** Final transactions that delivered nothing to the recipient in the quoted token. */
  unpaid: ChainTx[];
  /** Found but not final (an unconfirmed Bitcoin transaction). */
  pending: ChainTx[];
  /** Listed by 1Click but unknown to the chain. */
  absent: ChainTx[];
}

/** Compares the destination-chain reads with the quote: right recipient, right token. */
export function payoutCheck(obs: Observations, p: SwapRecord): PayoutCheck {
  const chain = p.destinationAsset ? assetChain(p.destinationAsset, obs.tokens) : "";
  const token = p.destinationAsset ? obs.tokens.get(p.destinationAsset) : undefined;
  const asset = chainAsset(chain, token);
  const final = obs.destinationTxs.filter((t) => t.found && t.succeeded);
  const hits = final.map((tx) => ({ tx, hit: p.recipient ? paidTo(tx, p.recipient, asset) : null }));
  const amounts = hits.flatMap(({ hit }) => (hit ? [hit.amount] : []));
  const paid =
    amounts.length === 0 ? null : { amount: amounts.includes(null) ? null : amounts.reduce<bigint>((sum, a) => sum + (a ?? 0n), 0n) };
  const unpaid = hits.filter(({ hit }) => !hit).map(({ tx }) => tx);
  return {
    chain,
    token,
    paid,
    unpaid: paid ? [] : unpaid,
    pending: obs.destinationTxs.filter((t) => t.found && !t.succeeded),
    absent: obs.destinationTxs.filter((t) => !t.found),
  };
}

function txLink(tx: ChainTx, kind: string): { label: string; href: string } {
  const info = CHAIN_INFO[tx.chain];
  return { label: `${info?.name ?? tx.chain} ${kind}`, href: info ? info.txUrl(tx.txHash) : tx.txHash };
}

/** Raw units to "49.836098 USDT"; the raw integer when the token is unknown. */
export function formatAmount(amount: bigint, token: TokenInfo | undefined): string {
  return token ? `${formatUnits(amount, token.decimals)} ${token.symbol}` : amount.toString();
}

/** Raw units to a decimal string: 15007338588 with 6 decimals is "15007.338588". */
export function formatUnits(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}

/** "WBTC on Ethereum"-style label from the token list; the raw asset id when the list does not have it. */
export function tokenLabel(assetId: string, obs: Pick<Observations, "tokens">): string {
  const token = obs.tokens.get(assetId);
  return token ? `${token.symbol} on ${chainLabel(token.blockchain)}` : assetId;
}
