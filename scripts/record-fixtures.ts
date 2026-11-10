// Usage: pnpm fixtures:record
// Re-captures every fixture case from live mainnet sources. Commit the result with the date it was taken.
import { writeFile } from "node:fs/promises";
import { observe, recordingFetch, type RecordedExchange, type Recording } from "@waybill/core";

const CASES: Omit<Recording, "recordedAt" | "exchanges">[] = [
  {
    case: "issue-384-confidential",
    description:
      "near/intents#384: confidential transfer the API marks SUCCESS; the public trail ends at the Confidential Intents treasury.",
    input: { depositAddress: "0x0B3e718FF16f00F67AD99f45efEB85eE49B771e5" },
  },
  {
    case: "issue-382-wrong-chain",
    description: "near/intents#382: ETH sent on Base to a deposit address quoted for Ethereum. No source knows the swap.",
    input: {
      depositAddress: "0xDF7A93d400159d0f8f40AAe42576d01285EA9e39",
      txHash: "0x4ae0bb73e8efe79bf5a3aedeb0302371ab0d7fe0a918ebd0b1c8054a9807c593",
    },
  },
  {
    case: "live-refunded-signed",
    description: "A live swap refunded with INTENT_SUBMIT_FAILED whose embedded quote signature verifies.",
    input: { depositAddress: "07e80e4816380cfc86f285a5819f5dcdb0ab980d4a205512b8f41ae477244670" },
  },
  {
    case: "live-eth-to-tron",
    description: "A live USDT Ethereum to Tron swap: deposit and NEAR settlement both readable on-chain.",
    input: { depositAddress: "0x1b05566BB59EF4Dd74c4766BD9BDB6E8092059E3" },
  },
  {
    case: "live-sol-to-btc",
    description: "A live SOL to BTC swap: Solana deposit (a version 1 transaction) and Bitcoin payout both read on-chain.",
    input: { depositAddress: "A3qqD1qs3yuinrP7aVzkvSdXJSgUo6hPFdPVeFvh4EJH" },
  },
  {
    case: "live-usdt-to-solana",
    description: "A live swap paid out as USDT on Solana: the SPL credit to the recipient's token account is read on-chain.",
    input: { depositAddress: "7f7b145138f714fa1aac2afd47adec70d54a0572e58cb3b00f1e0c4925f7af9e" },
  },
  {
    case: "live-tron-trx",
    description: "A live swap paid out as native TRX on Tron, with its Tron deposit, both read on-chain.",
    input: { depositAddress: "TLNavkAmFWDUgfGKpUYq1Nr82d1g2sfQ5S" },
  },
  {
    case: "live-eth-to-ton",
    description: "A live ETH to TON swap whose payout credits a brand-new wallet (TON marks it aborted, yet credited).",
    input: { depositAddress: "0x297b5c8F4901cd78B81687e1Ffff82Dcd3e55744" },
  },
];

for (const c of CASES) {
  const recording = await recordCase(c);
  const path = new URL(`../packages/core/fixtures/${c.case}.json`, import.meta.url);
  await writeFile(path, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`${c.case}: ${recording.exchanges.length} responses`);
}

/**
 * A fixture with a failed request would replay as a source failure, so a flaky public node is
 * retried rather than saved. Persistent failures stop the run instead of producing a bad fixture.
 */
async function recordCase(c: (typeof CASES)[number]): Promise<Recording> {
  for (let attempt = 1; ; attempt++) {
    const exchanges: RecordedExchange[] = [];
    const recordedAt = new Date().toISOString();
    // No JWT: fixtures must be reproducible by anyone.
    const { failures } = await observe({ ...c.input, fetchImpl: recordingFetch(exchanges), now: new Date(recordedAt) });
    if (failures.length === 0) return { ...c, recordedAt, exchanges };
    const reasons = failures.map((f) => `${f.label}: ${f.message}`).join("; ");
    if (attempt >= 3) throw new Error(`${c.case}: sources kept failing (${reasons})`);
    console.log(`${c.case}: retrying after ${reasons}`);
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
  }
}
