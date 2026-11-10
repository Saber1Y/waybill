import { z } from "zod";
import { capture, parseBody, type FetchOptions } from "../evidence";
import { CHAIN_INFO, NATIVE, normalizeAddress, rpcError, type ChainTx } from "./chains";

/** Public RPCs for the EVM chains 1Click accepts deposits on, keyed by the 1Click chain id. */
export const EVM_RPC: Record<string, string> = {
  eth: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  arb: "https://arb1.arbitrum.io/rpc",
  op: "https://mainnet.optimism.io",
  bsc: "https://bsc-dataseed.bnbchain.org",
  pol: "https://polygon-rpc.com",
  gnosis: "https://rpc.gnosischain.com",
  avax: "https://api.avax.network/ext/bc/C/rpc",
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
export const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Reads a receipt. ERC-20 transfers come with amounts; a native transfer is recorded as a payment
 * to the transaction's `to` with no amount, because receipts do not carry the value.
 */
export async function getEvmReceipt(chain: string, txHash: string, opts: FetchOptions = {}): Promise<ChainTx> {
  const rpc = EVM_RPC[chain];
  if (!rpc) throw new Error(`Unknown EVM chain: ${chain}`);
  const evidence = await capture("evm-rpc", `${CHAIN_INFO[chain]?.name ?? chain} receipt ${txHash}`, rpc, {
    ...opts,
    json: { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] },
  });
  rpcError(evidence, `${CHAIN_INFO[chain]?.name ?? chain} RPC`);
  const parsed = receiptSchema.safeParse(parseBody(evidence));
  const r = parsed.success ? parsed.data.result : null;
  if (!r) return { chain, txHash, evidence, found: false, succeeded: false, block: null, at: null, transfers: [] };
  const tokenTransfers = r.logs.flatMap((log) => {
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC || log.topics.length !== 3 || !log.topics[2]) return [];
    return [{ to: normalizeAddress(chain, `0x${log.topics[2].slice(26)}`), asset: normalizeAddress(chain, log.address), amount: BigInt(log.data) }];
  });
  return {
    chain,
    txHash,
    evidence,
    found: true,
    succeeded: r.status === "0x1",
    block: Number.parseInt(r.blockNumber, 16),
    at: null,
    transfers: [...(r.to ? [{ to: normalizeAddress(chain, r.to), asset: NATIVE, amount: null }] : []), ...tokenTransfers],
  };
}

/**
 * Looks for a transaction hash on every known EVM chain. A hash only exists on the chain it was sent
 * on, so this finds where a deposit actually landed, including the wrong chain.
 */
export async function findEvmTx(txHash: string, opts: FetchOptions = {}): Promise<ChainTx[]> {
  const results = await Promise.allSettled(Object.keys(EVM_RPC).map((chain) => getEvmReceipt(chain, txHash, opts)));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
