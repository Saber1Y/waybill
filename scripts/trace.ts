// Usage: pnpm trace <depositAddress> [depositTxHash] [--case]
// Traces one NEAR Intents swap against live sources and prints the legs and findings.
import { buildCase, trace } from "@waybill/core";

const args = process.argv.slice(2);
const printCase = args.includes("--case");
const [depositAddress, txHash] = args.filter((a) => !a.startsWith("--"));
if (!depositAddress) {
  console.error("Usage: pnpm trace <depositAddress> [depositTxHash] [--case]");
  process.exit(1);
}

const waybill = await trace({ depositAddress, txHash, jwt: process.env.NEAR_INTENTS_JWT || undefined });

if (printCase) {
  console.log(buildCase(waybill).markdown);
} else {
  console.log(`\n${depositAddress}  status: ${waybill.primary?.status ?? "unknown"}\n`);
  for (const leg of waybill.legs) console.log(`  [${leg.state.padEnd(14)}] ${leg.title}: ${leg.summary}`);
  console.log("");
  for (const f of waybill.findings) console.log(`  ${f.severity.toUpperCase().padEnd(8)} ${f.code}: ${f.title}`);
  console.log(`\n  ${waybill.observations.evidence.length} evidence items, ${waybill.failures.length} source failures`);
  for (const failure of waybill.failures) console.log(`  ! ${failure.label}: ${failure.message}`);
}
