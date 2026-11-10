import { createHash } from "node:crypto";
import { z } from "zod";
import { capture, parseBody, type FetchOptions } from "../evidence";
import { NATIVE, type ChainTx } from "./chains";
import { ERC20_TRANSFER_TOPIC } from "./evm-rpc";

export const TRONGRID_API = "https://api.trongrid.io";

const nativeSchema = z.looseObject({
  ret: z.array(z.looseObject({ contractRet: z.string().nullish() })).nullish(),
  raw_data: z.looseObject({
    timestamp: z.number().nullish(),
    contract: z.array(
      z.looseObject({
        type: z.string(),
        parameter: z.looseObject({ value: z.looseObject({ to_address: z.string().nullish(), amount: z.number().nullish() }) }),
      }),
    ),
  }),
});

const infoSchema = z.looseObject({
  blockNumber: z.number().nullish(),
  blockTimeStamp: z.number().nullish(),
  receipt: z.looseObject({ result: z.string().nullish() }).nullish(),
  log: z.array(z.looseObject({ address: z.string(), topics: z.array(z.string()), data: z.string().nullish() })).nullish(),
});

/**
 * A Tron transaction from TronGrid. A native TRX payout is read from the transaction itself, a TRC-20
 * payout from its execution info (Transfer logs); `asset` says which, so each read is one request.
 */
export async function getTronTx(txHash: string, opts: FetchOptions & { asset: string }): Promise<ChainTx> {
  const native = opts.asset === NATIVE;
  const path = native ? "/wallet/gettransactionbyid" : "/wallet/gettransactioninfobyid";
  const evidence = await capture("tron-api", `Tron ${native ? "transaction" : "transaction info"} ${txHash}`, `${TRONGRID_API}${path}`, {
    ...opts,
    json: { value: txHash },
  });
  if (evidence.httpStatus !== 200) throw new Error(`TronGrid answered HTTP ${evidence.httpStatus}`);
  const empty: ChainTx = { chain: "tron", txHash, evidence, found: false, succeeded: false, block: null, at: null, transfers: [] };
  const body = parseBody(evidence);

  if (native) {
    const parsed = nativeSchema.safeParse(body);
    if (!parsed.success) return empty;
    const tx = parsed.data;
    return {
      ...empty,
      found: true,
      succeeded: tx.ret?.[0]?.contractRet === "SUCCESS",
      at: tx.raw_data.timestamp ? new Date(tx.raw_data.timestamp).toISOString() : null,
      transfers: tx.raw_data.contract.flatMap((c) => {
        const { to_address: to, amount } = c.parameter.value;
        return c.type === "TransferContract" && to && amount != null ? [{ to: tronAddress(to), asset: NATIVE, amount: BigInt(amount) }] : [];
      }),
    };
  }

  const parsed = infoSchema.safeParse(body);
  if (!parsed.success || parsed.data.blockNumber == null) return empty;
  const info = parsed.data;
  return {
    ...empty,
    found: true,
    succeeded: info.receipt?.result === "SUCCESS",
    block: info.blockNumber ?? null,
    at: info.blockTimeStamp ? new Date(info.blockTimeStamp).toISOString() : null,
    transfers: (info.log ?? []).flatMap((log) => {
      if (`0x${log.topics[0] ?? ""}` !== ERC20_TRANSFER_TOPIC || log.topics.length !== 3 || !log.topics[2] || !log.data) return [];
      return [{ to: tronAddress(`41${log.topics[2].slice(24)}`), asset: tronAddress(`41${log.address.slice(-40)}`), amount: BigInt(`0x${log.data}`) }];
    }),
  };
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Hex `41…` address to the base58check `T…` form wallets and 1Click use. */
export function tronAddress(hex: string): string {
  const payload = Buffer.from(hex, "hex");
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  const bytes = Buffer.concat([payload, checksum]);
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}
