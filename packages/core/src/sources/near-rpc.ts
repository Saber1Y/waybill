import { z } from "zod";
import { capture, parseBody, type Evidence, type FetchOptions } from "../evidence";
import { INTENTS_CONTRACT } from "../swap";

/** Archival, so settlement transactions from weeks ago still resolve. */
export const NEAR_ARCHIVAL_RPC = "https://archival-rpc.mainnet.fastnear.com";

/** A NEP-297 event (`EVENT_JSON:` log line) emitted while the transaction executed. */
export interface NearEvent {
  executor: string;
  standard: string;
  event: string;
  data: unknown[];
}

/** One token movement inside intents.near, from nep245 mt_transfer / mt_mint / mt_burn events. */
export interface IntentsMovement {
  kind: "transfer" | "mint" | "burn";
  from: string | null;
  to: string | null;
  tokenId: string;
  amount: string;
}

export interface NearTx {
  hash: string;
  evidence: Evidence;
  found: boolean;
  signer: string | null;
  receiver: string | null;
  methods: string[];
  /** Overall result: true when no receipt failed. */
  succeeded: boolean;
  events: NearEvent[];
  movements: IntentsMovement[];
}

const rpcTxSchema = z.looseObject({
  result: z.looseObject({
    transaction: z.looseObject({
      signer_id: z.string(),
      receiver_id: z.string(),
      actions: z.array(z.unknown()),
    }),
    receipts_outcome: z.array(
      z.looseObject({
        outcome: z.looseObject({
          executor_id: z.string(),
          logs: z.array(z.string()),
          status: z.record(z.string(), z.unknown()),
        }),
      }),
    ),
  }),
});

const eventSchema = z.looseObject({ standard: z.string(), event: z.string(), data: z.array(z.unknown()).default([]) });
const mtDataSchema = z.looseObject({
  old_owner_id: z.string().optional(),
  new_owner_id: z.string().optional(),
  owner_id: z.string().optional(),
  token_ids: z.array(z.string()),
  amounts: z.array(z.string()),
});

export async function getNearTx(
  hash: string,
  opts: FetchOptions & { rpcUrl?: string; senderId?: string } = {},
): Promise<NearTx> {
  const request = {
    jsonrpc: "2.0",
    id: "waybill",
    method: "EXPERIMENTAL_tx_status",
    // The sender only routes the query to the right shard; any account works for lookup on archival nodes.
    params: { tx_hash: hash, sender_account_id: opts.senderId ?? INTENTS_CONTRACT, wait_until: "NONE" },
  };
  const evidence = await capture("near-rpc", `NEAR transaction ${hash}`, opts.rpcUrl ?? NEAR_ARCHIVAL_RPC, {
    ...opts,
    json: request,
  });
  return parseNearTx(hash, evidence);
}

export function parseNearTx(hash: string, evidence: Evidence): NearTx {
  const parsed = rpcTxSchema.safeParse(parseBody(evidence));
  if (!parsed.success) {
    return { hash, evidence, found: false, signer: null, receiver: null, methods: [], succeeded: false, events: [], movements: [] };
  }
  const { transaction, receipts_outcome } = parsed.data.result;
  const events: NearEvent[] = [];
  for (const { outcome } of receipts_outcome) {
    for (const log of outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const event = eventSchema.safeParse(JSON.parse(log.slice("EVENT_JSON:".length)));
        if (event.success) events.push({ executor: outcome.executor_id, ...event.data });
      } catch {
        // A malformed log line is not evidence of anything; skip it.
      }
    }
  }
  return {
    hash,
    evidence,
    found: true,
    signer: transaction.signer_id,
    receiver: transaction.receiver_id,
    methods: transaction.actions.flatMap((a) => {
      const call = z.looseObject({ FunctionCall: z.looseObject({ method_name: z.string() }) }).safeParse(a);
      return call.success ? [call.data.FunctionCall.method_name] : [];
    }),
    succeeded: receipts_outcome.every(({ outcome }) => !("Failure" in outcome.status)),
    events,
    movements: events.flatMap(toMovements),
  };
}

function toMovements(event: NearEvent): IntentsMovement[] {
  if (event.standard !== "nep245" || event.executor !== INTENTS_CONTRACT) return [];
  const kind = event.event === "mt_transfer" ? "transfer" : event.event === "mt_mint" ? "mint" : event.event === "mt_burn" ? "burn" : null;
  if (!kind) return [];
  return event.data.flatMap((raw) => {
    const d = mtDataSchema.safeParse(raw);
    if (!d.success) return [];
    return d.data.token_ids.map((tokenId, i) => ({
      kind,
      from: kind === "mint" ? null : (d.data.old_owner_id ?? d.data.owner_id ?? null),
      to: kind === "burn" ? null : (d.data.new_owner_id ?? d.data.owner_id ?? null),
      tokenId,
      amount: d.data.amounts[i] ?? "0",
    }));
  });
}
