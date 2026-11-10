import type { Evidence, FetchOptions } from "./evidence";
import { legs } from "./legs";
import type { Observations, Waybill } from "./model";
import { findings } from "./rules";
import { readChainTx } from "./sources/chain-read";
import { chainAsset, type ChainTx } from "./sources/chains";
import { findEvmTx, isEvmTxHash } from "./sources/evm-rpc";
import { fetchExplorerPage, searchExplorerApi } from "./sources/explorer";
import { getNearTx, type NearTx } from "./sources/near-rpc";
import { getStatus, getTokens, type TokenInfo } from "./sources/oneclick";
import { assetChain, type SwapRecord } from "./swap";
import { checkQuoteSignature } from "./verify";

export interface TraceInput extends FetchOptions {
  depositAddress: string;
  depositMemo?: string;
  /** The user's own deposit transaction. Lets Waybill find a deposit that went to the wrong chain. */
  txHash?: string;
  /** Partner JWT for the Explorer API and partner-scoped 1Click status. */
  jwt?: string;
  nearRpcUrl?: string;
  now?: Date;
}

/** Most NEAR settlement transactions per swap Waybill reads. Real swaps use one to three. */
const MAX_NEAR_TXS = 8;
/** Most origin or destination transactions per swap Waybill reads. */
const MAX_CHAIN_TXS = 4;

export interface SourceFailure {
  label: string;
  message: string;
}

/** Asks every source about one deposit address and records what each one said. Makes no judgement. */
export async function observe(input: TraceInput): Promise<Observations & { failures: SourceFailure[] }> {
  const depositAddress = input.depositAddress.trim();
  const fetchOpts: FetchOptions = { fetchImpl: input.fetchImpl, timeoutMs: input.timeoutMs };
  const failures: SourceFailure[] = [];
  const attempt = async <T>(label: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      failures.push({ label, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  const [status, api, page, tokenList] = await Promise.all([
    attempt("1Click status", () => getStatus(depositAddress, { ...fetchOpts, jwt: input.jwt, depositMemo: input.depositMemo })),
    input.jwt ? attempt("Explorer API", () => searchExplorerApi(depositAddress, { ...fetchOpts, jwt: input.jwt as string })) : null,
    attempt("Explorer page", () => fetchExplorerPage(depositAddress, fetchOpts)),
    attempt("1Click tokens", () => getTokens(fetchOpts)),
  ]);

  const evidence: Evidence[] = [status, api, page, tokenList].flatMap((r) => (r ? [r.evidence] : []));
  const records = [status, api, page].flatMap((r) => (r?.record ? [r.record] : []));
  const tokens = tokenList?.tokens ?? new Map<string, TokenInfo>();
  const signed = records.find((r) => r.signedQuote);

  const nearHashes = unique(records.flatMap((r) => r.nearTxHashes)).slice(0, MAX_NEAR_TXS);
  const nearTxs = (
    await Promise.all(nearHashes.map((hash) => attempt(`NEAR tx ${hash}`, () => getNearTx(hash, { ...fetchOpts, rpcUrl: input.nearRpcUrl }))))
  ).filter((tx): tx is NearTx => tx !== null);

  const [originTxs, destinationTxs] = await Promise.all([
    originLookups(input.txHash?.trim() ?? null, records, tokens, fetchOpts, attempt),
    chainLookups(records, tokens, "destination", fetchOpts, attempt),
  ]);

  return {
    depositAddress,
    userTxHash: input.txHash?.trim() || null,
    observedAt: (input.now ?? new Date()).toISOString(),
    records,
    signature: signed ? checkQuoteSignature(signed.signedQuote) : "absent",
    nearTxs,
    originTxs,
    destinationTxs,
    tokens,
    evidence: [...evidence, ...nearTxs.map((tx) => tx.evidence), ...originTxs.map((tx) => tx.evidence), ...destinationTxs.map((tx) => tx.evidence)],
    failures,
  };
}

type Attempt = <T>(label: string, run: () => Promise<T>) => Promise<T | null>;

async function originLookups(
  userTxHash: string | null,
  records: SwapRecord[],
  tokens: Map<string, TokenInfo>,
  fetchOpts: FetchOptions,
  attempt: Attempt,
): Promise<ChainTx[]> {
  const listed = await chainLookups(records, tokens, "origin", fetchOpts, attempt);
  if (!userTxHash || !isEvmTxHash(userTxHash) || listed.some((tx) => tx.txHash === userTxHash && tx.found)) return listed;
  // The user's hash is searched on every chain: where it exists is where the money actually went.
  const searched = (await attempt(`Search ${userTxHash}`, () => findEvmTx(userTxHash, fetchOpts))) ?? [];
  return [...listed, ...searched.filter((tx) => tx.found)];
}

async function chainLookups(
  records: SwapRecord[],
  tokens: Map<string, TokenInfo>,
  side: "origin" | "destination",
  fetchOpts: FetchOptions,
  attempt: Attempt,
): Promise<ChainTx[]> {
  const primary = records[0];
  const assetId = side === "origin" ? primary?.originAsset : primary?.destinationAsset;
  if (!assetId) return [];
  const chain = assetChain(assetId, tokens);
  const asset = chainAsset(chain, tokens.get(assetId));
  const hashes = unique(records.flatMap((r) => (side === "origin" ? r.originTxHashes : r.destinationTxHashes))).slice(0, MAX_CHAIN_TXS);
  const results = await Promise.all(hashes.map((hash) => attempt(`${chain} tx ${hash}`, () => readChainTx(chain, hash, asset, fetchOpts))));
  return results.filter((tx): tx is ChainTx => tx !== null);
}

export function judge(obs: Observations): Waybill {
  return { observations: obs, primary: obs.records[0] ?? null, legs: legs(obs), findings: findings(obs) };
}

export async function trace(input: TraceInput): Promise<Waybill & { failures: SourceFailure[] }> {
  const { failures, ...obs } = await observe(input);
  return { ...judge(obs), failures };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
