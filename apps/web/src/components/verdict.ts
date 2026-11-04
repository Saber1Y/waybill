import type { LegState, Waybill } from "@waybill/core";

export type Tone = "verified" | "reported" | "waiting" | "conflict" | "private";

export const LEG_TONE: Record<LegState, Tone | "muted"> = {
  verified: "verified",
  reported: "reported",
  waiting: "waiting",
  missing: "conflict",
  conflict: "conflict",
  private: "private",
  "not-applicable": "muted",
};

export const LEG_LABEL: Record<LegState, string> = {
  verified: "Verified on-chain",
  reported: "API says so",
  waiting: "Waiting",
  missing: "Missing",
  conflict: "Conflict",
  private: "Private chain",
  "not-applicable": "Not applicable",
};

export const TONE_TEXT: Record<Tone | "muted", string> = {
  verified: "text-verified",
  reported: "text-reported",
  waiting: "text-waiting",
  conflict: "text-conflict",
  private: "text-private",
  muted: "text-muted",
};

/** The one-word stamp at the top of the waybill. Critical findings always win. */
export function verdict(w: Waybill): { word: string; tone: Tone } {
  if (!w.primary) return { word: "Not found", tone: "conflict" };
  if (w.findings.some((f) => f.severity === "critical")) return { word: "Stalled", tone: "conflict" };
  const payout = w.legs.find((l) => l.key === "payout")?.state;
  if (w.primary.status === "REFUNDED") return { word: "Refunded", tone: "reported" };
  if (payout === "private") return { word: "Private leg", tone: "private" };
  if (w.primary.status === "SUCCESS") return { word: payout === "verified" ? "Delivered" : "Reported delivered", tone: payout === "verified" ? "verified" : "reported" };
  return { word: "In transit", tone: "waiting" };
}
