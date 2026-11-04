import { z } from "zod";
import { capture, parseBody, type Evidence, type FetchOptions } from "../evidence";
import { SWAP_STATUSES, type SwapRecord } from "../swap";

export const EXPLORER_BASE_URL = "https://explorer.near-intents.org";

const stringList = z.array(z.string()).nullish().transform((v) => v ?? []);

/** Shared by the Explorer API rows and the record the public explorer page embeds (a subset of the same fields). */
const explorerItemSchema = z.looseObject({
  status: z.enum(SWAP_STATUSES),
  depositAddress: z.string(),
  depositMemo: z.string().nullish(),
  createdAt: z.string().nullish(),
  originAsset: z.string(),
  destinationAsset: z.string().nullish(),
  amountInFormatted: z.string().nullish(),
  amountInUsd: z.string().nullish(),
  amountOutFormatted: z.string().nullish(),
  depositType: z.string().nullish(),
  recipient: z.string().nullish(),
  recipientType: z.string().nullish(),
  refundTo: z.string().nullish(),
  refundType: z.string().nullish(),
  refundReason: z.string().nullish(),
  refundedAmountFormatted: z.string().nullish(),
  intentHashes: z.union([z.string(), z.array(z.string())]).nullish(),
  nearTxHashes: stringList,
  originChainTxHashes: stringList,
  destinationChainTxHashes: stringList,
  /** Only on the public page: the origin-chain deposit transactions. */
  quoteTransactions: z.array(z.looseObject({ txHash: z.string() })).nullish(),
});

type ExplorerItem = z.infer<typeof explorerItemSchema>;

function toRecord(item: ExplorerItem, evidence: Evidence): SwapRecord {
  const intentHashes =
    typeof item.intentHashes === "string" ? item.intentHashes.split(",").filter(Boolean) : (item.intentHashes ?? []);
  const originTxHashes = [
    ...item.originChainTxHashes,
    ...(item.quoteTransactions ?? []).map((t) => t.txHash),
  ].filter((hash, i, all) => all.indexOf(hash) === i);
  return {
    evidenceId: evidence.id,
    depositAddress: item.depositAddress,
    depositMemo: item.depositMemo ?? null,
    status: item.status,
    createdAt: item.createdAt ?? null,
    updatedAt: null,
    originAsset: item.originAsset,
    destinationAsset: item.destinationAsset ?? null,
    amountInFormatted: item.amountInFormatted ?? null,
    amountInUsd: item.amountInUsd ?? null,
    amountOutFormatted: item.amountOutFormatted ?? null,
    depositType: (item.depositType as SwapRecord["depositType"]) ?? null,
    recipient: item.recipient ?? null,
    recipientType: (item.recipientType as SwapRecord["recipientType"]) ?? null,
    refundTo: item.refundTo ?? null,
    refundType: (item.refundType as SwapRecord["refundType"]) ?? null,
    deadline: null,
    intentHashes,
    nearTxHashes: item.nearTxHashes,
    originTxHashes,
    destinationTxHashes: item.destinationChainTxHashes,
    refundedAmountFormatted: item.refundedAmountFormatted ?? null,
    refundReason: item.refundReason ?? null,
    signedQuote: null,
  };
}

export interface ExplorerResult {
  evidence: Evidence;
  record: SwapRecord | null;
}

/** Explorer API search by deposit address. Needs a partner JWT; rate-limited to 1 request per 5 seconds. */
export async function searchExplorerApi(
  depositAddress: string,
  opts: FetchOptions & { jwt: string },
): Promise<ExplorerResult> {
  const url = new URL("/api/v0/transactions", EXPLORER_BASE_URL);
  url.searchParams.set("search", depositAddress);
  url.searchParams.set("numberOfTransactions", "10");
  const evidence = await capture("explorer-api", `Explorer API search for ${depositAddress}`, url.toString(), {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${opts.jwt}` },
  });
  const rows = z.array(z.unknown()).safeParse(parseBody(evidence));
  if (evidence.httpStatus !== 200 || !rows.success) return { evidence, record: null };
  for (const row of rows.data) {
    const item = explorerItemSchema.safeParse(row);
    if (item.success && item.data.depositAddress.toLowerCase() === depositAddress.toLowerCase()) {
      return { evidence, record: toRecord(item.data, evidence) };
    }
  }
  return { evidence, record: null };
}

/**
 * The public explorer page server-renders the swap as `initialItem` inside the RSC payload. This is not
 * an API: it needs no key but can break whenever the explorer frontend changes, so it is the fallback.
 */
export async function fetchExplorerPage(depositAddress: string, opts: FetchOptions = {}): Promise<ExplorerResult> {
  const url = `${EXPLORER_BASE_URL}/mask/${encodeURIComponent(depositAddress)}`;
  const evidence = await capture("explorer-page", `Public explorer page for ${depositAddress}`, url, opts);
  const item = extractInitialItem(evidence.body);
  const parsed = explorerItemSchema.safeParse(item);
  return { evidence, record: parsed.success ? toRecord(parsed.data, evidence) : null };
}

export function extractInitialItem(html: string): unknown {
  const marker = '\\"initialItem\\":';
  const start = html.indexOf(marker);
  if (start < 0) return undefined;
  // The payload is a JSON string inside a script, so its quotes arrive escaped.
  const text = html.slice(start + marker.length).replaceAll('\\\\', "\u0000").replaceAll('\\"', '"').replaceAll("\u0000", "\\");
  if (!text.startsWith("{")) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(0, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
