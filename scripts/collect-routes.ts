// Usage: pnpm routes:collect [--hours 24] [--settle 2] [--end <ISO time>]
// Collects every funded swap the Explorer API lists for a window and writes data/routes/snapshot.json.gz.
// The window ends `--settle` hours before now, so swaps still in flight are not counted as stuck.
// Needs NEAR_INTENTS_JWT. The API allows one request per 5 seconds; a day is about 50 pages.
// The window ends on a whole hour; re-running with the printed --end resumes from a checkpoint.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSnapshot, encodeSnapshot, getHistoryPage, getTokens, routeReport, type HistoryRow, type RouteSnapshot } from "@waybill/core";

const jwt = process.env.NEAR_INTENTS_JWT;
if (!jwt) {
  console.error("NEAR_INTENTS_JWT is not set. Get one at https://partners.near-intents.org and put it in .env.local.");
  process.exit(1);
}

const hours = numberFlag("--hours", 24);
const settle = numberFlag("--settle", 2);
const collectedAt = new Date();
const endFlag = process.argv.indexOf("--end");
const end =
  endFlag >= 0
    ? new Date(process.argv[endFlag + 1] ?? "")
    : new Date(Math.floor((collectedAt.getTime() - settle * 3_600_000) / 3_600_000) * 3_600_000);
if (Number.isNaN(end.getTime()) || collectedAt.getTime() - end.getTime() < settle * 3_600_000) {
  throw new Error(`--end must be a time at least ${settle} hours ago`);
}
const start = new Date(end.getTime() - hours * 3_600_000);
const RATE_LIMIT_MS = 5_500;
const PAGE_SIZE = 500;

console.log(`Window ${start.toISOString()} to ${end.toISOString()} (${hours}h, settled ${settle}h)`);
console.log(`If this stops, resume with: pnpm routes:collect --hours ${hours} --end ${end.toISOString()}`);
const { tokens } = await getTokens();

// Deep cursors over a whole day get slow enough to time out, so the window is read one hour at a
// time, newest first. Finished hours are checkpointed, so a failed run resumes where it stopped.
const checkpointPath = path.join(tmpdir(), `waybill-routes-${start.getTime()}-${end.getTime()}.json`);
const done: Record<string, { rows: HistoryRow[]; pages: RouteSnapshot["pages"] }> = await readCheckpoint();
const CHUNK_MS = 3_600_000;
let lastRequest = 0;
for (let chunkEnd = end.getTime(); chunkEnd > start.getTime(); chunkEnd -= CHUNK_MS) {
  const chunkStart = Math.max(start.getTime(), chunkEnd - CHUNK_MS);
  const key = String(chunkStart);
  if (done[key]) {
    console.log(`${new Date(chunkStart).toISOString()}: ${done[key].rows.length} rows (checkpoint)`);
    continue;
  }
  const chunk = { rows: [] as HistoryRow[], pages: [] as RouteSnapshot["pages"] };
  let after: string | undefined;
  for (;;) {
    await sleep(Math.max(0, lastRequest + RATE_LIMIT_MS - Date.now()));
    const result = await withRetry(() => {
      lastRequest = Date.now();
      return getHistoryPage({ startUnix: chunkStart / 1000, endUnix: chunkEnd / 1000, after, pageSize: PAGE_SIZE }, { jwt, timeoutMs: 120_000 });
    });
    const { evidence } = result;
    chunk.pages.push({
      url: evidence.url,
      fetchedAt: evidence.fetchedAt,
      httpStatus: evidence.httpStatus,
      sha256: evidence.sha256,
      rows: result.rows.length,
      rejected: result.rejected,
    });
    chunk.rows.push(...result.rows);
    if (!result.next) break;
    after = result.next;
  }
  done[key] = chunk;
  await writeFile(checkpointPath, JSON.stringify(done));
  console.log(`${new Date(chunkStart).toISOString()}: ${chunk.rows.length} rows in ${chunk.pages.length} pages`);
}

const ordered = Object.keys(done).sort((a, b) => Number(b) - Number(a)).map((k) => done[k] as (typeof done)[string]);
const rows = ordered.flatMap((c) => c.rows);
const pages = ordered.flatMap((c) => c.pages);
const snapshot = buildSnapshot({ collectedAt, start, end, pages, rows, tokens });
await mkdir(new URL("../data/routes/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/routes/snapshot.json.gz", import.meta.url), encodeSnapshot(snapshot));
await rm(checkpointPath, { force: true });
const { overall } = routeReport(snapshot);
console.log(
  `\n${snapshot.swaps.length} swaps from ${pages.length} pages: ${overall.success} success, ${overall.refunded} refunded, ` +
    `${overall.failed} failed, ${overall.stuck} stuck, ${overall.incomplete} incomplete deposits`,
);

function numberFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= 5) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  retrying after: ${message.slice(0, 120)}`);
      // A 429 or a slow page: back off well past the rate limit.
      await sleep(RATE_LIMIT_MS * 2 * attempt);
    }
  }
}

async function readCheckpoint(): Promise<typeof done> {
  try {
    return JSON.parse(await readFile(checkpointPath, "utf8")) as typeof done;
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
