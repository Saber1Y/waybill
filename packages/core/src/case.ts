import { sha256Hex } from "./evidence";
import type { LegState, Waybill } from "./model";
import { tokenLabel } from "./legs";

const STATE_LABEL: Record<LegState, string> = {
  verified: "Verified on-chain",
  reported: "Reported by API only",
  waiting: "Waiting",
  missing: "Missing",
  conflict: "Conflict",
  private: "Private (confidential chain)",
  "not-applicable": "Not applicable",
};

export interface CaseFile {
  /** SHA-256 over the evidence hashes and findings, so anyone can tell if the packet was edited. */
  caseHash: string;
  markdown: string;
}

/**
 * Builds the evidence packet a user can paste into a support ticket or a GitHub issue. It states what
 * each source returned and which documented rule is broken; it never guesses at a cause.
 */
export function buildCase(waybill: Waybill): CaseFile {
  const { observations: obs, primary, legs, findings } = waybill;
  const caseHash = sha256Hex(
    JSON.stringify({
      depositAddress: obs.depositAddress,
      observedAt: obs.observedAt,
      evidence: obs.evidence.map((e) => [e.url, e.fetchedAt, e.sha256]),
      findings: findings.map((f) => f.code),
    }),
  );
  const serious = findings.filter((f) => f.severity !== "info");
  const lines: string[] = [];

  lines.push(`## ${serious[0]?.title ?? findings[0]?.title ?? "NEAR Intents swap record"}`, "");
  lines.push(`Deposit address: \`${obs.depositAddress}\`  `);
  if (obs.userTxHash) lines.push(`Deposit transaction: \`${obs.userTxHash}\`  `);
  lines.push(`Checked: ${obs.observedAt} (Waybill case \`${caseHash.slice(0, 16)}\`)`, "");

  if (primary) {
    lines.push("### What the quote promised", "");
    lines.push(`- Swap: ${primary.amountInFormatted ?? "?"} ${tokenLabel(primary.originAsset, obs)} to ${primary.destinationAsset ? tokenLabel(primary.destinationAsset, obs) : "?"}`);
    if (primary.deadline) lines.push(`- Deadline: ${primary.deadline}`);
    lines.push(`- Refund address: \`${primary.refundTo ?? "not set"}\` (${primary.refundType ?? "?"})`);
    lines.push(`- Recipient: \`${primary.recipient ?? "not shown"}\` (${primary.recipientType ?? "?"})`);
    lines.push(`- Quote signature: ${obs.signature === "valid" ? "valid, signed by 1Click" : obs.signature === "unverified" ? "present, could not be verified" : "not available from this source"}`);
    lines.push(`- Current status: **${primary.status}**${primary.updatedAt ? ` (updated ${primary.updatedAt})` : ""}`, "");
  }

  lines.push("### What Waybill found", "");
  if (findings.length === 0) lines.push("- No broken promises found.");
  for (const f of findings) {
    lines.push(`- **${f.title}.** ${f.detail}${f.rule ? ` Documented rule: "${f.rule.text}" (${f.rule.href})` : ""}`);
  }
  lines.push("");

  lines.push("### Leg by leg", "", "| Leg | State | What the evidence shows |", "| --- | --- | --- |");
  for (const leg of legs) lines.push(`| ${leg.title} | ${STATE_LABEL[leg.state]} | ${leg.summary.replaceAll("|", "\\|")} |`);
  lines.push("");

  lines.push("### Evidence", "", "Every row can be re-fetched; the SHA-256 is of the exact response body Waybill received.", "");
  lines.push("| Source | Request | HTTP | Fetched | SHA-256 |", "| --- | --- | --- | --- | --- |");
  for (const e of obs.evidence) {
    lines.push(`| ${e.source} | [${e.label}](${e.url}) | ${e.httpStatus} | ${e.fetchedAt} | \`${e.sha256.slice(0, 16)}…\` |`);
  }
  if (serious.length > 0) {
    lines.push("", "### Requested", "", "1. The current state of this swap.", "2. A refund to the refund address in the quote, or a written reason for the delay.", "3. A timeline.");
  }

  return { caseHash, markdown: lines.join("\n") };
}
