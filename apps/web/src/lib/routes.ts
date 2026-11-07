import "server-only";
import { decodeSnapshot, routeReport, type RouteReport, type RouteSnapshot } from "@waybill/core";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Written by `pnpm routes:collect` at the repository root; the page is rendered from it at build time. */
export const SNAPSHOT_PATH = "data/routes/snapshot.json.gz";

export async function loadRouteReport(): Promise<{ snapshot: RouteSnapshot; report: RouteReport } | null> {
  // Next.js runs from apps/web, two levels below the repository root.
  const file = path.join(process.cwd(), "..", "..", SNAPSHOT_PATH);
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const snapshot = decodeSnapshot(data);
  return { snapshot, report: routeReport(snapshot) };
}
