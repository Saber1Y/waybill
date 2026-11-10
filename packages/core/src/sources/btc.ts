import { z } from "zod";
import { capture, parseBody, type FetchOptions } from "../evidence";
import { NATIVE, normalizeAddress, type ChainTx } from "./chains";

export const MEMPOOL_API = "https://mempool.space/api";

const txSchema = z.looseObject({
  status: z.looseObject({ confirmed: z.boolean(), block_height: z.number().nullish(), block_time: z.number().nullish() }),
  vout: z.array(z.looseObject({ scriptpubkey_address: z.string().nullish(), value: z.number() })),
});

/** A Bitcoin transaction from mempool.space. Succeeded means confirmed in a block; outputs are the transfers. */
export async function getBtcTx(txHash: string, opts: FetchOptions = {}): Promise<ChainTx> {
  const evidence = await capture("btc-api", `Bitcoin transaction ${txHash}`, `${MEMPOOL_API}/tx/${txHash}`, opts);
  // mempool.space answers 400/404 for an unknown or malformed txid; anything else is the service failing.
  if (evidence.httpStatus !== 200 && evidence.httpStatus !== 400 && evidence.httpStatus !== 404) {
    throw new Error(`mempool.space answered HTTP ${evidence.httpStatus}`);
  }
  const parsed = txSchema.safeParse(parseBody(evidence));
  if (evidence.httpStatus !== 200 || !parsed.success) {
    return { chain: "btc", txHash, evidence, found: false, succeeded: false, block: null, at: null, transfers: [] };
  }
  const { status, vout } = parsed.data;
  return {
    chain: "btc",
    txHash,
    evidence,
    found: true,
    succeeded: status.confirmed,
    block: status.block_height ?? null,
    at: status.block_time ? new Date(status.block_time * 1000).toISOString() : null,
    transfers: vout.flatMap((o) =>
      o.scriptpubkey_address ? [{ to: normalizeAddress("btc", o.scriptpubkey_address), asset: NATIVE, amount: BigInt(o.value) }] : [],
    ),
  };
}
