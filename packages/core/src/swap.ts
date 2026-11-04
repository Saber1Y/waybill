export const SWAP_STATUSES = [
  "KNOWN_DEPOSIT_TX",
  "PENDING_DEPOSIT",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

export type PartyType = "ORIGIN_CHAIN" | "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";

/**
 * One view of a swap, normalized from whichever source reported it. Waybill keeps one record per
 * source and compares them instead of merging, so a disagreement stays visible.
 */
export interface SwapRecord {
  evidenceId: string;
  depositAddress: string;
  depositMemo: string | null;
  status: SwapStatus;
  createdAt: string | null;
  updatedAt: string | null;
  originAsset: string;
  destinationAsset: string | null;
  amountInFormatted: string | null;
  amountInUsd: string | null;
  amountOutFormatted: string | null;
  depositType: PartyType | null;
  recipient: string | null;
  recipientType: PartyType | null;
  refundTo: string | null;
  refundType: PartyType | null;
  /** Quote promise: after this the deposit address may stop working. Only the 1Click status carries it. */
  deadline: string | null;
  intentHashes: string[];
  nearTxHashes: string[];
  originTxHashes: string[];
  destinationTxHashes: string[];
  refundedAmountFormatted: string | null;
  refundReason: string | null;
  /** The signed quote, when the source included it. */
  signedQuote: unknown;
}

export function isTerminal(status: SwapStatus): boolean {
  return status === "SUCCESS" || status === "REFUNDED" || status === "FAILED";
}

/**
 * The chain an asset lives on, preferring the 1Click token list and falling back to the id's prefix:
 * "nep141:base-0x....omft.near" -> "base", "nep141:wrap.near" -> "near".
 */
export function assetChain(assetId: string, tokens?: Map<string, { blockchain: string }>): string {
  const listed = tokens?.get(assetId)?.blockchain;
  if (listed) return listed;
  const token = assetId.replace(/^nep\d+:/, "");
  const omft = /^([a-z0-9]+)(?:-[^.]+)?\.omft\.near$/.exec(token);
  if (omft?.[1]) return omft[1];
  return "near";
}

/** The account the Confidential Intents bridge locks public tokens in. A production constant per
 * https://docs.near-intents.org/integration/market-makers/confidential-intents (PRIVATE_TREASURY_ACCOUNT_ID). */
export const CONFIDENTIAL_TREASURY = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";

export const INTENTS_CONTRACT = "intents.near";
