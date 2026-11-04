import { SWAP_SOURCES } from "./evidence";
import type { Finding, Observations } from "./model";
import { paysAddress, EVM_CHAINS } from "./sources/evm-rpc";
import { assetChain, CONFIDENTIAL_TREASURY, isTerminal, type SwapRecord } from "./swap";

const DOCS_STATUS = "https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api";
const DOCS_CONFIDENTIAL = "https://docs.near-intents.org/integration/market-makers/confidential-intents";
const HOUR = 3_600_000;

/** How long PROCESSING with no intent hash can last before it stops looking like normal solver latency. */
export const PROCESSING_GRACE_MS = HOUR;

export function findings(obs: Observations): Finding[] {
  const primary = obs.records[0] ?? null;
  const now = Date.parse(obs.observedAt);
  const out: Finding[] = [];

  const landed = obs.originTxs.filter((tx) => paysAddress(tx, obs.depositAddress));
  const expectedChain = primary ? assetChain(primary.originAsset, obs.tokens) : null;

  if (!primary) {
    out.push({
      code: "NO_RECORD",
      severity: landed.length > 0 ? "critical" : "warning",
      title: "No NEAR Intents source knows this deposit address",
      detail:
        landed.length > 0
          ? "Money reached this address on-chain, but neither 1Click nor the explorer has a swap for it."
          : "Neither 1Click nor the explorer returned a swap for this address. Check the address, or add your deposit transaction hash.",
      evidenceIds: obs.evidence.filter((e) => SWAP_SOURCES.includes(e.source)).map((e) => e.id),
    });
  }

  for (const tx of landed) {
    if (expectedChain && tx.chain === expectedChain) continue;
    const chain = EVM_CHAINS[tx.chain]?.name ?? tx.chain;
    out.push({
      code: "WRONG_CHAIN_DEPOSIT",
      severity: "critical",
      title: `Deposit landed on ${chain}${expectedChain ? `, but the quote expects ${EVM_CHAINS[expectedChain]?.name ?? expectedChain}` : ""}`,
      detail: `Transaction ${tx.txHash} paid the deposit address on ${chain} in block ${tx.blockNumber}. The same address exists on every EVM chain, but 1Click only watches the chain the quote was issued for, so this deposit will not be picked up automatically.`,
      evidenceIds: [tx.evidence.id],
    });
  }

  if (!primary) return out;

  const disagreeing = obs.records.filter((r) => r.status !== primary.status);
  if (disagreeing.length > 0) {
    out.push({
      code: "SOURCES_DISAGREE",
      severity: "warning",
      title: "NEAR Intents sources report different statuses",
      detail: obs.records.map((r) => `${sourceName(r, obs)}: ${r.status}`).join("; ") + ".",
      evidenceIds: obs.records.map((r) => r.evidenceId),
    });
  }

  if (primary.status === "PROCESSING" && primary.intentHashes.length === 0) {
    const since = Date.parse(primary.createdAt ?? primary.updatedAt ?? "");
    if (Number.isFinite(since) && now - since > PROCESSING_GRACE_MS) {
      out.push({
        code: "PROCESSING_WITHOUT_INTENT",
        severity: "critical",
        title: `PROCESSING for ${formatDuration(now - since)} with no intent created`,
        detail:
          "1Click detected the deposit, but no intent hash was ever recorded, so no solver has executed this swap. Nothing has moved on NEAR Intents for it.",
        rule: { text: "A swap either completes or is refunded to the refund address.", href: DOCS_STATUS },
        evidenceIds: [primary.evidenceId],
      });
    }
  }

  const deadline = Date.parse(primary.deadline ?? "");
  if (!isTerminal(primary.status) && Number.isFinite(deadline) && now > deadline) {
    out.push({
      code: "DEADLINE_PASSED_UNRESOLVED",
      severity: "critical",
      title: `Quote deadline passed ${formatDuration(now - deadline)} ago with no payout or refund`,
      detail: `The signed quote set a deadline of ${primary.deadline}. The swap is still ${primary.status}, and the refund address (${primary.refundTo ?? "not set"}) has received ${primary.refundedAmountFormatted ?? "0"}.`,
      rule: { text: "A swap either completes or is refunded to the refund address.", href: DOCS_STATUS },
      evidenceIds: [primary.evidenceId],
    });
  }

  if (primary.status === "SUCCESS") out.push(...successChecks(primary, obs));

  if (primary.status === "REFUNDED") {
    out.push({
      code: "REFUNDED",
      severity: "info",
      title: `Refunded${primary.refundReason ? `: ${primary.refundReason}` : ""}`,
      detail: `1Click reports ${primary.refundedAmountFormatted ?? "an unknown amount"} returned to ${primary.refundTo ?? "the refund address"}.`,
      evidenceIds: [primary.evidenceId],
    });
  }

  if (primary.status === "FAILED") {
    out.push({
      code: "FAILED",
      severity: "critical",
      title: "1Click reports the swap FAILED",
      detail: `Refunded so far: ${primary.refundedAmountFormatted ?? "0"} to ${primary.refundTo ?? "the refund address"}.`,
      rule: { text: "A swap either completes or is refunded to the refund address.", href: DOCS_STATUS },
      evidenceIds: [primary.evidenceId],
    });
  }

  if (obs.signature === "unverified") {
    out.push({
      code: "SIGNATURE_UNVERIFIED",
      severity: "info",
      title: "Quote terms could not be checked against 1Click's signature",
      detail: "1Click returned a signature, but it did not verify with the official SDK for this payload. The terms above are as 1Click reports them, not independently proven.",
      evidenceIds: [primary.evidenceId],
    });
  }

  return out;
}

function successChecks(primary: SwapRecord, obs: Observations): Finding[] {
  const out: Finding[] = [];
  const movements = obs.nearTxs.flatMap((tx) => tx.movements.map((m) => ({ ...m, evidenceId: tx.evidence.id })));

  if (primary.recipientType === "CONFIDENTIAL_INTENTS") {
    const shielded = movements.filter((m) => m.to === CONFIDENTIAL_TREASURY);
    out.push({
      code: "CONFIDENTIAL_LEG",
      severity: "info",
      title: "The rest of this swap is on the confidential chain",
      detail: `${shielded.length > 0 ? "The public trail ends at the Confidential Intents treasury, as designed. " : ""}Delivery to the recipient happens on the private chain, which only the recipient's 1Click account and the operator can see. A SUCCESS here cannot be checked from public data.`,
      rule: { text: "Shielded tokens are held by the Treasury account and minted as IMT on the private chain.", href: DOCS_CONFIDENTIAL },
      evidenceIds: [...new Set(shielded.map((m) => m.evidenceId))],
    });
    return out;
  }

  if (primary.recipientType === "INTENTS" && primary.recipient && movements.length > 0) {
    const toRecipient = movements.some((m) => m.to === primary.recipient);
    if (!toRecipient) {
      const receivers = [...new Set(movements.map((m) => m.to).filter(Boolean))];
      out.push({
        code: "PAID_TO_OTHER_ACCOUNT",
        severity: "critical",
        title: "Reported SUCCESS, but no token movement reached the recipient",
        detail: `The settlement transactions moved tokens to ${receivers.join(", ")}, not to the quoted recipient ${primary.recipient}.`,
        evidenceIds: [...new Set(movements.map((m) => m.evidenceId))],
      });
    }
  }

  if (primary.recipientType === "DESTINATION_CHAIN" && primary.destinationTxHashes.length === 0) {
    out.push({
      code: "SUCCESS_WITHOUT_PAYOUT_PROOF",
      severity: "warning",
      title: "Reported SUCCESS with no destination-chain transaction",
      detail: "No source lists a payout transaction on the destination chain, so the delivery cannot be checked.",
      evidenceIds: [primary.evidenceId],
    });
  }
  return out;
}

function sourceName(record: SwapRecord, obs: Observations): string {
  const source = obs.evidence.find((e) => e.id === record.evidenceId)?.source;
  return source === "oneclick-status" ? "1Click status" : source === "explorer-api" ? "Explorer API" : "Explorer page";
}

export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / HOUR);
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}
