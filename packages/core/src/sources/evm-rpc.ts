import { z } from "zod";
import { capture, parseBody, type Evidence, type FetchOptions } from "../evidence";

/** Public RPCs for the EVM chains 1Click accepts deposits on, keyed by the 1Click chain id. */
export const EVM_CHAINS: Record<string, { name: string; rpc: string; explorer: string }> = {
  eth: { name: "Ethereum", rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io" },
  base: { name: "Base", rpc: "https://mainnet.base.org", explorer: "https://basescan.org" },
  arb: { name: "Arbitrum", rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io" },
  op: { name: "Optimism", rpc: "https://mainnet.optimism.io", explorer: "https://optimistic.etherscan.io" },
  bsc: { name: "BNB Chain", rpc: "https://bsc-dataseed.bnbchain.org", explorer: "https://bscscan.com" },
  pol: { name: "Polygon", rpc: "https://polygon-rpc.com", explorer: "https://polygonscan.com" },
  gnosis: { name: "Gnosis", rpc: "https://rpc.gnosischain.com", explorer: "https://gnosisscan.io" },
  avax: { name: "Avalanche", rpc: "https://api.avax.network/ext/bc/C/rpc", explorer: "https://snowtrace.io" },
};

export function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isEvmTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

const receiptSchema = z.looseObject({
  result: z
    .looseObject({
      status: z.string(),
      blockNumber: z.string(),
      from: z.string(),
      to: z.string().nullable(),
      logs: z.array(z.looseObject({ address: z.string(), topics: z.array(z.string()), data: z.string() })),
    })
    .nullable(),
});

/** keccak256("Transfer(address,address,uint256)") */
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface EvmTransfer {
  chain: string;
  txHash: string;
  evidence: Evidence;
  found: boolean;
  succeeded: boolean;
  blockNumber: number | null;
  from: string | null;
  /** Native-value recipient (the `to` of the transaction). */
  to: string | null;
  /** ERC-20 transfers in the receipt: token contract, recipient and raw amount. */
  tokenTransfers: { token: string; to: string; amount: bigint }[];
}

export async function getEvmReceipt(chain: string, txHash: string, opts: FetchOptions = {}): Promise<EvmTransfer> {
  const config = EVM_CHAINS[chain];
  if (!config) throw new Error(`Unknown EVM chain: ${chain}`);
  const evidence = await capture("evm-rpc", `${config.name} receipt ${txHash}`, config.rpc, {
    ...opts,
    json: { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] },
  });
  const parsed = receiptSchema.safeParse(parseBody(evidence));
  const r = parsed.success ? parsed.data.result : null;
  if (!r) {
    return { chain, txHash, evidence, found: false, succeeded: false, blockNumber: null, from: null, to: null, tokenTransfers: [] };
  }
  return {
    chain,
    txHash,
    evidence,
    found: true,
    succeeded: r.status === "0x1",
    blockNumber: Number.parseInt(r.blockNumber, 16),
    from: r.from.toLowerCase(),
    to: r.to?.toLowerCase() ?? null,
    tokenTransfers: r.logs.flatMap((log) => {
      if (log.topics[0] !== ERC20_TRANSFER_TOPIC || log.topics.length !== 3 || !log.topics[2]) return [];
      return [{ token: log.address.toLowerCase(), to: `0x${log.topics[2].slice(26)}`.toLowerCase(), amount: BigInt(log.data) }];
    }),
  };
}

/** True when this transaction paid `address`, natively or through an ERC-20 transfer. */
export function paysAddress(tx: EvmTransfer, address: string): boolean {
  const target = address.toLowerCase();
  return tx.succeeded && (tx.to === target || tx.tokenTransfers.some((t) => t.to === target));
}

/**
 * Looks for a transaction hash on every known EVM chain. A hash only exists on the chain it was sent
 * on, so this finds where a deposit actually landed, including the wrong chain.
 */
export async function findEvmTx(txHash: string, opts: FetchOptions = {}): Promise<EvmTransfer[]> {
  const results = await Promise.allSettled(Object.keys(EVM_CHAINS).map((chain) => getEvmReceipt(chain, txHash, opts)));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
