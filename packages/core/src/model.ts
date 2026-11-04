import type { Evidence } from "./evidence";
import type { EvmTransfer } from "./sources/evm-rpc";
import type { NearTx } from "./sources/near-rpc";
import type { TokenInfo } from "./sources/oneclick";
import type { SwapRecord } from "./swap";
import type { SignatureCheck } from "./verify";

/** Everything Waybill gathered about one deposit address, before any judgement. */
export interface Observations {
  depositAddress: string;
  /** The user's own deposit transaction hash, when they gave one. */
  userTxHash: string | null;
  observedAt: string;
  /** One per source that knew the swap, most authoritative first (1Click status, Explorer API, explorer page). */
  records: SwapRecord[];
  signature: SignatureCheck;
  nearTxs: NearTx[];
  /** Origin-chain lookups, including every chain searched for the user's tx hash. */
  originTxs: EvmTransfer[];
  destinationTxs: EvmTransfer[];
  /** Asset id -> symbol and chain, from the public 1Click token list. */
  tokens: Map<string, TokenInfo>;
  /** Sources that were asked; whether they knew the swap or not. */
  evidence: Evidence[];
}

export type LegState =
  /** Proven by an on-chain read Waybill made itself. */
  | "verified"
  /** Only an API says so; no independent on-chain proof yet. */
  | "reported"
  | "waiting"
  | "missing"
  /** Sources disagree, or the chain contradicts the API. */
  | "conflict"
  /** Happens on the confidential chain, which only the owner and the operator can see. */
  | "private"
  | "not-applicable";

export interface Leg {
  key: "quote" | "deposit" | "settlement" | "payout";
  title: string;
  state: LegState;
  /** One plain sentence on what the evidence shows. */
  summary: string;
  at: string | null;
  links: { label: string; href: string }[];
  evidenceIds: string[];
}

export type Severity = "critical" | "warning" | "info";

export interface Finding {
  code:
    | "NO_RECORD"
    | "WRONG_CHAIN_DEPOSIT"
    | "DEADLINE_PASSED_UNRESOLVED"
    | "PROCESSING_WITHOUT_INTENT"
    | "SUCCESS_WITHOUT_PAYOUT_PROOF"
    | "PAID_TO_OTHER_ACCOUNT"
    | "CONFIDENTIAL_LEG"
    | "SOURCES_DISAGREE"
    | "REFUNDED"
    | "FAILED"
    | "SIGNATURE_UNVERIFIED";
  severity: Severity;
  title: string;
  /** What the evidence shows, in plain words, without guessing at causes. */
  detail: string;
  /** The documented rule this breaks, when there is one. */
  rule?: { text: string; href: string };
  evidenceIds: string[];
}

export interface Waybill {
  observations: Observations;
  /** The record the legs are drawn from (the most authoritative source that knew the swap). */
  primary: SwapRecord | null;
  legs: Leg[];
  findings: Finding[];
}
