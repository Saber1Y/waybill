import { z } from "zod";
import { capture, parseBody, type FetchOptions } from "../evidence";
import { NATIVE, rpcError, type ChainTransfer, type ChainTx } from "./chains";

export const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

const tokenBalance = z.looseObject({
  accountIndex: z.number(),
  mint: z.string(),
  owner: z.string().nullish(),
  uiTokenAmount: z.looseObject({ amount: z.string() }),
});

const txSchema = z.looseObject({
  result: z
    .looseObject({
      slot: z.number(),
      blockTime: z.number().nullish(),
      meta: z.looseObject({
        err: z.unknown(),
        preBalances: z.array(z.number()),
        postBalances: z.array(z.number()),
        preTokenBalances: z.array(tokenBalance).nullish(),
        postTokenBalances: z.array(tokenBalance).nullish(),
      }),
      transaction: z.looseObject({
        message: z.looseObject({ accountKeys: z.array(z.union([z.string(), z.looseObject({ pubkey: z.string() })])) }),
      }),
    })
    .nullable(),
});

/**
 * A Solana transaction from the public RPC. Transfers are balance increases: SPL tokens credited to
 * their owner (not the token account), and lamports credited to an account.
 */
export async function getSolanaTx(signature: string, opts: FetchOptions & { rpcUrl?: string } = {}): Promise<ChainTx> {
  const evidence = await capture("sol-rpc", `Solana transaction ${signature}`, opts.rpcUrl ?? SOLANA_RPC, {
    ...opts,
    json: {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "finalized" }],
    },
  });
  rpcError(evidence, "Solana RPC");
  const parsed = txSchema.safeParse(parseBody(evidence));
  const r = parsed.success ? parsed.data.result : null;
  if (!r) return { chain: "sol", txHash: signature, evidence, found: false, succeeded: false, block: null, at: null, transfers: [] };

  const keys = r.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const transfers: ChainTransfer[] = [];
  keys.forEach((key, i) => {
    const delta = BigInt(r.meta.postBalances[i] ?? 0) - BigInt(r.meta.preBalances[i] ?? 0);
    if (delta > 0n) transfers.push({ to: key, asset: NATIVE, amount: delta });
  });
  const pre = new Map((r.meta.preTokenBalances ?? []).map((b) => [b.accountIndex, BigInt(b.uiTokenAmount.amount)]));
  for (const b of r.meta.postTokenBalances ?? []) {
    const delta = BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex) ?? 0n);
    if (delta > 0n && b.owner) transfers.push({ to: b.owner, asset: b.mint, amount: delta });
  }
  return {
    chain: "sol",
    txHash: signature,
    evidence,
    found: true,
    succeeded: r.meta.err === null,
    block: r.slot,
    at: r.blockTime ? new Date(r.blockTime * 1000).toISOString() : null,
    transfers,
  };
}
