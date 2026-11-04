import "server-only";
import { trace } from "@waybill/core";
import { cache } from "react";

/** One live trace per request, shared by the page and its metadata. */
export const traceSwap = cache((depositAddress: string, txHash: string | undefined) =>
  trace({
    depositAddress,
    txHash,
    jwt: process.env.NEAR_INTENTS_JWT || undefined,
    nearRpcUrl: process.env.NEAR_RPC_URL || undefined,
  }),
);
