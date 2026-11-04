import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";

/**
 * "unverified" is not "forged": some status responses carry a quote that does not hash to its
 * signature under the SDK's scheme (seen on live swaps, 2026-11-04), so a failed check only means
 * Waybill cannot vouch for these terms itself.
 */
export type SignatureCheck = "valid" | "unverified" | "absent";

/**
 * Checks a quote (or the quote embedded in a status response) against 1Click's published manager key,
 * using the official SDK so the hashing matches theirs exactly. A valid signature means 1Click itself
 * issued these terms: deposit address, amounts, deadline, refund address.
 */
export function checkQuoteSignature(signedQuote: unknown): SignatureCheck {
  if (!signedQuote || typeof signedQuote !== "object" || !("signature" in signedQuote)) return "absent";
  return verifyQuoteSignature(signedQuote as Parameters<typeof verifyQuoteSignature>[0]) ? "valid" : "unverified";
}
