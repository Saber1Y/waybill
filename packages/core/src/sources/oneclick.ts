import { z } from "zod";
import { capture, parseBody, type Evidence, type FetchOptions } from "../evidence";
import { SWAP_STATUSES, type SwapRecord } from "../swap";

export const ONECLICK_BASE_URL = "https://1click.chaindefuser.com";

const txList = z.array(z.looseObject({ hash: z.string() })).default([]);

const statusSchema = z.looseObject({
  correlationId: z.string(),
  status: z.enum(SWAP_STATUSES),
  updatedAt: z.string(),
  quoteResponse: z.looseObject({
    signature: z.string().optional(),
    timestamp: z.string().optional(),
    quoteRequest: z.looseObject({
      originAsset: z.string(),
      destinationAsset: z.string(),
      depositType: z.string().optional(),
      recipient: z.string().optional(),
      recipientType: z.string().optional(),
      refundTo: z.string().optional(),
      refundType: z.string().optional(),
    }),
    quote: z.looseObject({
      depositAddress: z.string().optional(),
      depositMemo: z.string().nullish(),
      amountInFormatted: z.string().optional(),
      amountInUsd: z.string().optional(),
      amountOutFormatted: z.string().optional(),
      deadline: z.string().optional(),
    }),
  }),
  swapDetails: z.looseObject({
    intentHashes: z.array(z.string()).default([]),
    nearTxHashes: z.array(z.string()).default([]),
    originChainTxHashes: txList,
    destinationChainTxHashes: txList,
    refundedAmountFormatted: z.string().nullish(),
    refundReason: z.string().nullish(),
  }),
});

export interface StatusResult {
  evidence: Evidence;
  /** null when 1Click answered but does not know the address (404) or the body did not parse. */
  record: SwapRecord | null;
}

/**
 * GET /v0/status. Without a partner JWT this only finds swaps quoted without a key; with one it
 * finds that partner's swaps. Other partners' swaps answer 404, which is not proof the swap is unknown.
 */
export async function getStatus(
  depositAddress: string,
  opts: FetchOptions & { jwt?: string; depositMemo?: string } = {},
): Promise<StatusResult> {
  const url = new URL("/v0/status", ONECLICK_BASE_URL);
  url.searchParams.set("depositAddress", depositAddress);
  if (opts.depositMemo) url.searchParams.set("depositMemo", opts.depositMemo);
  const evidence = await capture("oneclick-status", `1Click status for ${depositAddress}`, url.toString(), {
    ...opts,
    headers: { ...opts.headers, ...(opts.jwt ? { "X-API-Key": opts.jwt } : {}) },
  });
  return { evidence, record: evidence.httpStatus === 200 ? toRecord(evidence, depositAddress) : null };
}

export function toRecord(evidence: Evidence, depositAddress: string): SwapRecord | null {
  const parsed = statusSchema.safeParse(parseBody(evidence));
  if (!parsed.success) return null;
  const { status, updatedAt, quoteResponse, swapDetails } = parsed.data;
  const { quoteRequest: req, quote } = quoteResponse;
  return {
    evidenceId: evidence.id,
    depositAddress: quote.depositAddress ?? depositAddress,
    depositMemo: quote.depositMemo ?? null,
    status,
    createdAt: quoteResponse.timestamp ?? null,
    updatedAt,
    originAsset: req.originAsset,
    destinationAsset: req.destinationAsset,
    amountInFormatted: quote.amountInFormatted ?? null,
    amountInUsd: quote.amountInUsd ?? null,
    amountOutFormatted: quote.amountOutFormatted ?? null,
    depositType: (req.depositType as SwapRecord["depositType"]) ?? null,
    recipient: req.recipient ?? null,
    recipientType: (req.recipientType as SwapRecord["recipientType"]) ?? null,
    refundTo: req.refundTo ?? null,
    refundType: (req.refundType as SwapRecord["refundType"]) ?? null,
    deadline: quote.deadline ?? null,
    intentHashes: swapDetails.intentHashes,
    nearTxHashes: swapDetails.nearTxHashes,
    originTxHashes: swapDetails.originChainTxHashes.map((t) => t.hash),
    destinationTxHashes: swapDetails.destinationChainTxHashes.map((t) => t.hash),
    refundedAmountFormatted: swapDetails.refundedAmountFormatted ?? null,
    refundReason: swapDetails.refundReason ?? null,
    signedQuote: quoteResponse,
  };
}

export interface TokenInfo {
  assetId: string;
  symbol: string;
  /** 1Click chain id: "eth", "base", "near", "btc", ... */
  blockchain: string;
  decimals: number;
}

const tokensSchema = z.array(
  z.looseObject({ assetId: z.string(), symbol: z.string(), blockchain: z.string(), decimals: z.number() }),
);

/** GET /v0/tokens, public. Maps asset ids to symbol and chain. */
export async function getTokens(opts: FetchOptions = {}): Promise<{ evidence: Evidence; tokens: Map<string, TokenInfo> }> {
  const evidence = await capture("oneclick-tokens", "1Click supported tokens", `${ONECLICK_BASE_URL}/v0/tokens`, opts);
  const parsed = tokensSchema.safeParse(parseBody(evidence));
  const tokens = new Map<string, TokenInfo>();
  if (parsed.success) for (const t of parsed.data) tokens.set(t.assetId, { assetId: t.assetId, symbol: t.symbol, blockchain: t.blockchain, decimals: t.decimals });
  return { evidence, tokens };
}
