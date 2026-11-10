import { parseBody, type Evidence, type FetchOptions } from "../evidence";
import type { TokenInfo } from "./oneclick";

/** One transaction on an origin or destination chain, read by Waybill itself. Same shape on every chain. */
export interface ChainTx {
  /** 1Click chain id: "eth", "btc", "sol", ... */
  chain: string;
  txHash: string;
  evidence: Evidence;
  found: boolean;
  /** Executed and final as far as the chain reports (confirmed, no error, not bounced). */
  succeeded: boolean;
  block: number | null;
  /** Block time, ISO 8601. */
  at: string | null;
  /** Value this transaction delivered. Addresses are normalized with `normalizeAddress`. */
  transfers: ChainTransfer[];
}

export interface ChainTransfer {
  to: string;
  /** "native", or the token contract / mint / jetton master, normalized. */
  asset: string;
  /** Raw units. Null when the chain read does not include the amount (an EVM receipt's native value). */
  amount: bigint | null;
}

export const NATIVE = "native";

export interface ChainInfo {
  name: string;
  txUrl: (hash: string) => string;
}

/** Chains Waybill can read transactions on, beyond NEAR itself. */
export const CHAIN_INFO: Record<string, ChainInfo> = {
  eth: { name: "Ethereum", txUrl: (h) => `https://etherscan.io/tx/${h}` },
  base: { name: "Base", txUrl: (h) => `https://basescan.org/tx/${h}` },
  arb: { name: "Arbitrum", txUrl: (h) => `https://arbiscan.io/tx/${h}` },
  op: { name: "Optimism", txUrl: (h) => `https://optimistic.etherscan.io/tx/${h}` },
  bsc: { name: "BNB Chain", txUrl: (h) => `https://bscscan.com/tx/${h}` },
  pol: { name: "Polygon", txUrl: (h) => `https://polygonscan.com/tx/${h}` },
  gnosis: { name: "Gnosis", txUrl: (h) => `https://gnosisscan.io/tx/${h}` },
  avax: { name: "Avalanche", txUrl: (h) => `https://snowtrace.io/tx/${h}` },
  btc: { name: "Bitcoin", txUrl: (h) => `https://mempool.space/tx/${h}` },
  sol: { name: "Solana", txUrl: (h) => `https://solscan.io/tx/${h}` },
  tron: { name: "Tron", txUrl: (h) => `https://tronscan.org/#/transaction/${h}` },
  ton: { name: "TON", txUrl: (h) => `https://tonviewer.com/transaction/${h}` },
};

export function chainLabel(chain: string): string {
  return CHAIN_INFO[chain]?.name ?? chain;
}

/**
 * One spelling per address, so the quoted recipient and the chain's own output compare equal.
 * EVM hex and bech32 are case-insensitive; base58 (Solana, Tron, legacy Bitcoin) is not; TON
 * user-friendly addresses become their raw `workchain:HEX` form.
 */
export function normalizeAddress(chain: string, address: string): string {
  const value = address.trim();
  if (/^0x[0-9a-fA-F]+$/.test(value)) return value.toLowerCase();
  if (chain === "btc" && /^bc1/i.test(value)) return value.toLowerCase();
  if (chain === "ton") return tonRawAddress(value) ?? value;
  return value;
}

/** `EQ…`/`UQ…` (36 bytes, base64url) or `0:abc…` to `0:ABC…`. Null when it is neither. */
export function tonRawAddress(address: string): string | null {
  const raw = /^(-?\d+):([0-9a-fA-F]{64})$/.exec(address);
  if (raw) return `${raw[1]}:${raw[2]?.toUpperCase()}`;
  if (!/^[A-Za-z0-9_\-+/]{48}$/.test(address)) return null;
  const bytes = Buffer.from(address.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (bytes.length !== 36) return null;
  const workchain = bytes.readInt8(1);
  return `${workchain}:${bytes.subarray(2, 34).toString("hex").toUpperCase()}`;
}

/** The asset a token pays out as on its own chain: its contract, or native when the token list gives none. */
export function chainAsset(chain: string, token: TokenInfo | undefined): string {
  return token?.contractAddress ? normalizeAddress(chain, token.contractAddress) : NATIVE;
}

/**
 * What `tx` delivered to `address`, in `asset` when given. Null when nothing reached the address;
 * an amount of null means the address was paid but the read does not say how much.
 */
export function paidTo(tx: ChainTx, address: string, asset?: string): { amount: bigint | null } | null {
  if (!tx.found || !tx.succeeded) return null;
  const target = normalizeAddress(tx.chain, address);
  const hits = tx.transfers.filter((t) => t.to === target && (asset === undefined || t.asset === asset));
  if (hits.length === 0) return null;
  if (hits.some((t) => t.amount === null)) return { amount: null };
  return { amount: hits.reduce((sum, t) => sum + (t.amount ?? 0n), 0n) };
}

export type ChainReader = (txHash: string, opts: FetchOptions & { asset: string }) => Promise<ChainTx>;

/**
 * Throws when a JSON-RPC call failed (HTTP error, or an `error` member), so a failing node is
 * reported as a source failure and never mistaken for "the transaction does not exist".
 */
export function rpcError(evidence: Evidence, name: string): void {
  if (evidence.httpStatus !== 200) throw new Error(`${name} answered HTTP ${evidence.httpStatus}`);
  const body = parseBody(evidence) as { error?: { message?: string } } | undefined;
  if (body?.error) throw new Error(`${name} error: ${body.error.message ?? JSON.stringify(body.error)}`);
}
