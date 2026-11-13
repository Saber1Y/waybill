import { z } from "zod";
import { formatUnits, tokenLabel } from "./legs";
import type { Observations } from "./model";
import { MIN_SWAPS_FOR_RATE, type RouteStats } from "./routes";
import { chainLabel } from "./sources/chains";
import { EVM_RPC, isEvmAddress } from "./sources/evm-rpc";
import { assetChain } from "./swap";

const DOCS_QUOTE = "https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote";
const DOCS_SIGNATURE = "https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature";

export type CheckState = "ok" | "info" | "warn" | "stop";

export interface PreSendCheck {
  state: CheckState;
  label: string;
  detail: string;
  rule?: { text: string; href: string };
}

export interface PreSendResult {
  verdict: "send" | "check" | "stop";
  /** The one instruction a sender needs, when there is a quote to send to. */
  instruction: {
    /** "exactly", "at least", or null when the amount is not known. */
    qualifier: "exactly" | "at least" | "any amount" | null;
    /** Decimal amount, or null when no source gave one. */
    amount: string | null;
    /** "USDC on Ethereum" */
    token: string;
    /** A sentence on what happens above or below the amount. */
    note: string | null;
    address: string;
    memo: string | null;
    before: string | null;
  } | null;
  checks: PreSendCheck[];
}

/** Time to leave between sending and the refund deadline: a deposit must be mined before it. */
const CONFIRMATION_MARGIN_MS: Record<string, number> = { btc: 90 * 60_000, ltc: 30 * 60_000, doge: 30 * 60_000, bch: 30 * 60_000, zec: 30 * 60_000 };
const DEFAULT_MARGIN_MS = 15 * 60_000;

/** A route below this completion rate earns a warning before sending. */
export const RELIABLE_ROUTE = 0.97;

const signedQuoteSchema = z.looseObject({
  quoteRequest: z.looseObject({
    swapType: z.string().nullish(),
    deadline: z.string().nullish(),
  }),
  quote: z.looseObject({
    amountIn: z.string().nullish(),
    minAmountIn: z.string().nullish(),
    deadline: z.string().nullish(),
  }),
});

/**
 * What a sender should know before paying a deposit address: what exactly to send, where, by when,
 * and anything that would lose or delay the money. Judges only what the sources returned.
 */
export function preSend(obs: Observations, route: RouteStats | null): PreSendResult {
  const p = obs.records[0];
  if (!p) {
    return {
      verdict: "stop",
      instruction: null,
      checks: [
        {
          state: "stop",
          label: "No quote for this address",
          detail: "Neither 1Click nor the NEAR Intents explorer knows this deposit address. Money sent here will not be swapped. Get a fresh quote from your wallet or app and check that address instead.",
        },
      ],
    };
  }

  const now = Date.parse(obs.observedAt);
  const chain = assetChain(p.originAsset, obs.tokens);
  const token = obs.tokens.get(p.originAsset);
  const signed = signedQuoteSchema.safeParse(p.signedQuote);
  const terms = signed.success ? signed.data : null;
  const checks: PreSendCheck[] = [];

  // Status: an address is for one swap. Anything past PENDING_DEPOSIT means it was already paid.
  if (p.status === "PENDING_DEPOSIT") {
    checks.push({ state: "ok", label: "Waiting for your deposit", detail: "1Click has not received anything at this address yet." });
  } else if (p.status === "INCOMPLETE_DEPOSIT") {
    checks.push({
      state: "warn",
      label: "A deposit already arrived, below the quoted amount",
      detail: "1Click marked this address INCOMPLETE_DEPOSIT. Trace it before sending more; a top-up may or may not complete the swap.",
    });
  } else {
    checks.push({
      state: "stop",
      label: `This address was already used (${p.status})`,
      detail: "Each deposit address belongs to one swap. Another payment here is outside the quote. Get a fresh quote instead.",
    });
  }

  // Deadlines. The quote's deadline is when the address goes inactive; the request's is when refunds begin.
  const inactiveAt = Date.parse(terms?.quote.deadline ?? p.deadline ?? "");
  const refundAt = Date.parse(terms?.quoteRequest.deadline ?? "");
  const margin = CONFIRMATION_MARGIN_MS[chain] ?? DEFAULT_MARGIN_MS;
  if (Number.isFinite(inactiveAt) && now >= inactiveAt) {
    checks.push({
      state: "stop",
      label: "This deposit address is inactive",
      detail: `It went inactive at ${iso(inactiveAt)}. Money sent now may be lost.`,
      rule: { text: "Time when the deposit address becomes inactive and funds may be lost.", href: DOCS_QUOTE },
    });
  } else if (Number.isFinite(refundAt) && now >= refundAt) {
    checks.push({
      state: "stop",
      label: "The quote has expired",
      detail: `Its deadline was ${iso(refundAt)}. A deposit now will not be swapped at these terms; it is refunded to ${p.refundTo ?? "the refund address"}.`,
      rule: { text: "When the user refund begins if the swap isn't completed by then.", href: DOCS_QUOTE },
    });
  } else if (Number.isFinite(refundAt) && refundAt - now < margin) {
    checks.push({
      state: "warn",
      label: `Only ${minutes(refundAt - now)} left`,
      detail: `The deposit has to confirm on ${chainLabel(chain)} before ${iso(refundAt)}. If it confirms late, it is refunded instead of swapped. A fresh quote is safer.`,
      rule: { text: "It must exceed the time required for the deposit transaction to be mined.", href: DOCS_QUOTE },
    });
  } else if (Number.isFinite(refundAt)) {
    checks.push({ state: "ok", label: `Send before ${iso(refundAt)}`, detail: `${minutes(refundAt - now)} left, enough for the deposit to confirm on ${chainLabel(chain)}.` });
  } else {
    checks.push({
      state: "warn",
      label: "Deadline unknown",
      detail: "No source returned the quote's deadline, so Waybill cannot say how long this address accepts deposits.",
    });
  }

  // Signature: are these terms 1Click's own?
  if (obs.signature === "valid") {
    checks.push({ state: "ok", label: "Terms signed by 1Click", detail: "The amount, deadline and refund address below were checked against 1Click's signature.", rule: { text: "Confirm quote and status payloads are signed by 1Click.", href: DOCS_SIGNATURE } });
  } else {
    // A present signature that fails the official SDK is common on genuine live quotes (the cause is not
    // known yet), so it is a note; no signature at all means only the explorer vouches for the terms.
    checks.push({
      state: obs.signature === "absent" ? "warn" : "info",
      label: obs.signature === "absent" ? "Terms not signed" : "Signature did not verify",
      detail:
        obs.signature === "absent"
          ? "Only the explorer knows this quote, and it carries no signature. Compare the terms with what your wallet showed."
          : "1Click returned a signature that did not verify with the official SDK. Compare the terms with what your wallet showed.",
    });
  }

  // The one chain this address is watched on.
  if (isEvmAddress(p.depositAddress) && EVM_RPC[chain]) {
    checks.push({
      state: "info",
      label: `Send on ${chainLabel(chain)} only`,
      detail: `This address exists on every EVM chain, but 1Click only watches ${chainLabel(chain)}. Sending on another chain is the mistake in near/intents#382.`,
    });
  }
  if (p.depositMemo) {
    checks.push({
      state: "warn",
      label: "Memo required",
      detail: `Include the memo ${p.depositMemo} with the transfer. Without it, 1Click cannot match the deposit to this swap.`,
    });
  }

  // Refund and recipient, so the sender can compare them with their own addresses.
  checks.push(
    p.refundTo
      ? { state: "info", label: "Refunds go to", detail: p.refundTo }
      : { state: "warn", label: "No refund address", detail: "No source returned a refund address for this quote." },
  );
  if (p.recipient) {
    const to = p.destinationAsset ? ` on ${chainLabel(assetChain(p.destinationAsset, obs.tokens))}` : "";
    checks.push({ state: "info", label: "Delivers to", detail: `${p.recipient}${to}` });
  }

  // How this route has done lately.
  if (route?.completion) {
    const rate = route.completion;
    const pct = `${(rate.value * 100).toFixed(1)}%`;
    const topReason = Object.entries(route.refundReasons).sort((a, b) => b[1] - a[1])[0];
    checks.push(
      rate.value >= RELIABLE_ROUTE
        ? { state: "ok", label: `This route completed ${pct} of swaps`, detail: `${route.swaps - route.incomplete} swaps from ${chainLabel(route.from)} to ${chainLabel(route.to)} in the latest snapshot.` }
        : {
            state: "warn",
            label: `This route completed only ${pct} of swaps`,
            detail: `${route.refunded} of ${route.swaps - route.incomplete} recent swaps from ${chainLabel(route.from)} to ${chainLabel(route.to)} were refunded${topReason ? `, most often ${topReason[0]}` : ""}. A refund returns the money, minus fees, after a delay.`,
          },
    );
  } else if (p.destinationAsset) {
    const to = assetChain(p.destinationAsset, obs.tokens);
    checks.push({
      state: "info",
      label: "Not enough recent swaps to rate this route",
      detail: `${route?.swaps ?? 0} swaps from ${chainLabel(chain)} to ${chainLabel(to)} in the latest snapshot; Waybill rates a route from ${MIN_SWAPS_FOR_RATE}.`,
    });
  }

  const instruction = {
    ...amountToSend(terms, p.amountInFormatted, token?.decimals ?? null),
    token: tokenLabel(p.originAsset, obs),
    address: p.depositAddress,
    memo: p.depositMemo,
    before: Number.isFinite(refundAt) ? iso(refundAt) : null,
  };
  const verdict = checks.some((c) => c.state === "stop") ? "stop" : checks.some((c) => c.state === "warn") ? "check" : "send";
  return { verdict, instruction, checks };
}

/** What to send, following the swap type's rules for amountIn and minAmountIn. */
function amountToSend(
  terms: z.infer<typeof signedQuoteSchema> | null,
  reported: string | null,
  decimals: number | null,
): Pick<NonNullable<PreSendResult["instruction"]>, "qualifier" | "amount" | "note"> {
  const units = (raw: string | null | undefined) => (raw && decimals !== null ? formatUnits(BigInt(raw), decimals) : null);
  const amountIn = units(terms?.quote.amountIn);
  const minIn = units(terms?.quote.minAmountIn);
  switch (terms?.quoteRequest.swapType) {
    case "EXACT_INPUT":
      if (amountIn) return { qualifier: "exactly", amount: amountIn, note: "Less is refunded instead of swapped; any excess is refunded after the swap." };
      break;
    case "EXACT_OUTPUT":
      if (minIn) return { qualifier: "at least", amount: minIn, note: `${amountIn ?? "The quoted amount"} is quoted with slippage; anything not needed is refunded after the swap.` };
      break;
    case "FLEX_INPUT":
      if (minIn) return { qualifier: "at least", amount: minIn, note: "Larger deposits are swapped too, as long as the minimum output is met." };
      break;
    case "ANY_INPUT":
      return { qualifier: "any amount", amount: null, note: null };
  }
  // Explorer records of unfunded quotes report the amount as "0", which is not an instruction.
  return reported && Number(reported) > 0 ? { qualifier: null, amount: reported, note: null } : { qualifier: null, amount: null, note: null };
}

function iso(ms: number): string {
  return `${new Date(ms).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function minutes(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 120) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
}
