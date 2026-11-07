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
  // The API hides PENDING_DEPOSIT and INCOMPLETE_DEPOSIT unless asked; a stuck user may be in either.
  url.searchParams.set("statuses", SWAP_STATUSES.filter((s) => s !== "KNOWN_DEPOSIT_TX").join(","));
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

/** The fields route statistics need from one Explorer API row. */
const historyRowSchema = z.looseObject({
  depositAddressAndMemo: z.string(),
  status: z.enum(SWAP_STATUSES),
  createdAtTimestamp: z.number(),
  originAsset: z.string(),
  destinationAsset: z.string(),
  amountInUsd: z.string().nullish(),
  refundReason: z.string().nullish(),
});

export type HistoryRow = z.infer<typeof historyRowSchema>;

export interface HistoryPageQuery {
  /** Inclusive start and exclusive end of the window, Unix seconds. */
  startUnix: number;
  endUnix: number;
  /** Cursor: `depositAddressAndMemo` of the last row of the previous page. */
  after?: string;
  pageSize?: number;
}

export interface HistoryPage {
  evidence: Evidence;
  rows: HistoryRow[];
  /** Rows the schema rejected. Counted, never silently dropped. */
  rejected: number;
  /** Cursor for the next (older) page; null when this page was the last. */
  next: string | null;
}

/** Statuses of swaps whose deposit arrived. PENDING_DEPOSIT (a quote nobody funded) is left out. */
export const FUNDED_STATUSES = ["INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;

/** One page of swap history, newest first. Needs a partner JWT; callers must wait 5 seconds between pages. */
export async function getHistoryPage(query: HistoryPageQuery, opts: FetchOptions & { jwt: string }): Promise<HistoryPage> {
  const url = new URL("/api/v0/transactions", EXPLORER_BASE_URL);
  url.searchParams.set("numberOfTransactions", String(query.pageSize ?? 1000));
  url.searchParams.set("statuses", FUNDED_STATUSES.join(","));
  // The API's start bound is exclusive; one second earlier makes the window inclusive.
  url.searchParams.set("startTimestampUnix", String(query.startUnix - 1));
  url.searchParams.set("endTimestampUnix", String(query.endUnix));
  if (query.after) url.searchParams.set("lastDepositAddressAndMemo", query.after);
  const evidence = await capture("explorer-api", "Explorer API swap history page", url.toString(), {
    timeoutMs: 60_000,
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${opts.jwt}` },
  });
  if (evidence.httpStatus !== 200) {
    throw new Error(`Explorer API answered HTTP ${evidence.httpStatus}: ${evidence.body.slice(0, 200)}`);
  }
  const list = z.array(z.unknown()).safeParse(parseBody(evidence));
  if (!list.success) throw new Error("Explorer API history page is not a JSON array");
  const rows: HistoryRow[] = [];
  for (const row of list.data) {
    const parsed = historyRowSchema.safeParse(row);
    if (parsed.success) rows.push(parsed.data);
  }
  const last = z.looseObject({ depositAddressAndMemo: z.string() }).safeParse(list.data.at(-1));
  const full = list.data.length >= (query.pageSize ?? 1000);
  return { evidence, rows, rejected: list.data.length - rows.length, next: full && last.success ? last.data.depositAddressAndMemo : null };
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
