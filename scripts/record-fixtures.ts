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
];

for (const c of CASES) {
  const exchanges: RecordedExchange[] = [];
  const recordedAt = new Date().toISOString();
  // No JWT: fixtures must be reproducible by anyone.
  await observe({ ...c.input, fetchImpl: recordingFetch(exchanges), now: new Date(recordedAt) });
  const recording: Recording = { ...c, recordedAt, exchanges };
  const path = new URL(`../packages/core/fixtures/${c.case}.json`, import.meta.url);
  await writeFile(path, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`${c.case}: ${exchanges.length} responses`);
}
