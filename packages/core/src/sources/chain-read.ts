import type { FetchOptions } from "../evidence";
import { getBtcTx } from "./btc";
import { NATIVE, type ChainTx } from "./chains";
import { EVM_RPC, getEvmReceipt, isEvmTxHash } from "./evm-rpc";
import { getSolanaTx } from "./solana";
import { getTonTx } from "./ton";
import { getTronTx } from "./tron";

const HEX64 = /^[0-9a-fA-F]{64}$/;
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/**
 * Whether Waybill can read a transaction of this shape on this chain for this asset. TON jetton
 * transfers are not read yet: their payout lands in a jetton wallet the recipient does not own by address.
 */
export function canReadChainTx(chain: string, txHash: string, asset: string): boolean {
  if (EVM_RPC[chain]) return isEvmTxHash(txHash);
  if (chain === "btc" || chain === "tron") return HEX64.test(txHash);
  if (chain === "sol") return BASE58_SIGNATURE.test(txHash);
  if (chain === "ton") return HEX64.test(txHash) && asset === NATIVE;
  return false;
}

/** Reads one transaction on its own chain, or returns null when Waybill has no reader for it. */
export async function readChainTx(chain: string, txHash: string, asset: string, opts: FetchOptions = {}): Promise<ChainTx | null> {
  if (!canReadChainTx(chain, txHash, asset)) return null;
  if (EVM_RPC[chain]) return getEvmReceipt(chain, txHash, opts);
  if (chain === "btc") return getBtcTx(txHash, opts);
  if (chain === "sol") return getSolanaTx(txHash, opts);
  if (chain === "tron") return getTronTx(txHash, { ...opts, asset });
  return getTonTx(txHash, opts);
}
