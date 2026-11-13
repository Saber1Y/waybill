import "server-only";
import { assetChain, observe, preSend } from "@waybill/core";
import { cache } from "react";
import { loadRouteReport } from "./routes";

/** One live pre-send check per request, shared by the page and its metadata. */
export const checkDeposit = cache(async (depositAddress: string) => {
  const { failures, ...obs } = await observe({
    depositAddress,
    jwt: process.env.NEAR_INTENTS_JWT || undefined,
    nearRpcUrl: process.env.NEAR_RPC_URL || undefined,
  });
  const quote = obs.records[0];
  const report = quote?.destinationAsset ? (await loadRouteReport())?.report : null;
  const from = quote ? assetChain(quote.originAsset, obs.tokens) : null;
  const to = quote?.destinationAsset ? assetChain(quote.destinationAsset, obs.tokens) : null;
  const route = report?.routes.find((r) => r.from === from && r.to === to) ?? null;
  return { obs, failures, result: preSend(obs, route) };
});
