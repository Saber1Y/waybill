import { z } from "zod";
import { capture, parseBody, type FetchOptions } from "../evidence";
import { NATIVE, tonRawAddress, type ChainTx } from "./chains";

export const TONCENTER_API = "https://toncenter.com/api/v3";

const txSchema = z.looseObject({
  transactions: z.array(
    z.looseObject({
      account: z.string(),
      now: z.number().nullish(),
      mc_block_seqno: z.number().nullish(),
      description: z.looseObject({
        credit_ph: z.looseObject({ credit: z.string().nullish() }).nullish(),
        bounce: z.unknown().optional(),
      }),
    }),
  ),
});

/**
 * The recipient side of a TON payout, from toncenter. 1Click lists the transaction in which the
 * recipient's wallet received the coins, so the transfer is that wallet's credit. A brand-new wallet
 * reports the transaction as aborted (it has no code to run) but is still credited, so the credit is
 * what counts; a bounce means the coins went back.
 */
export async function getTonTx(txHash: string, opts: FetchOptions = {}): Promise<ChainTx> {
  const url = `${TONCENTER_API}/transactions?hash=${encodeURIComponent(txHash)}&limit=1`;
  const evidence = await capture("ton-api", `TON transaction ${txHash}`, url, opts);
  if (evidence.httpStatus !== 200) throw new Error(`toncenter answered HTTP ${evidence.httpStatus}`);
  const parsed = txSchema.safeParse(parseBody(evidence));
  const tx = parsed.success ? parsed.data.transactions[0] : undefined;
  if (!tx) return { chain: "ton", txHash, evidence, found: false, succeeded: false, block: null, at: null, transfers: [] };
  const credit = BigInt(tx.description.credit_ph?.credit ?? "0");
  const bounced = tx.description.bounce != null;
  return {
    chain: "ton",
    txHash,
    evidence,
    found: true,
    succeeded: credit > 0n && !bounced,
    block: tx.mc_block_seqno ?? null,
    at: tx.now ? new Date(tx.now * 1000).toISOString() : null,
    transfers: credit > 0n && !bounced ? [{ to: tonRawAddress(tx.account) ?? tx.account, asset: NATIVE, amount: credit }] : [],
  };
}
