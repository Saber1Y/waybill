import { createHash } from "node:crypto";

export type SourceId = "oneclick-status" | "oneclick-tokens" | "explorer-api" | "explorer-page" | "near-rpc" | "evm-rpc";

/** Sources that describe the swap itself (as opposed to chain reads and reference data). */
export const SWAP_SOURCES: readonly SourceId[] = ["oneclick-status", "explorer-api", "explorer-page"];

/**
 * One raw response from one source, kept exactly as received. Every claim Waybill makes points at
 * one or more of these, so a reader can re-fetch the URL and compare.
 */
export interface Evidence {
  id: string;
  source: SourceId;
  /** What was asked, in plain words ("1Click status for 0xabc"). */
  label: string;
  method: "GET" | "POST";
  url: string;
  /** JSON-RPC or POST body, without credentials. */
  request?: unknown;
  fetchedAt: string;
  httpStatus: number;
  body: string;
  /** SHA-256 of `body`, hex. */
  sha256: string;
}

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Fetches a URL and records the response as evidence. Network errors throw; HTTP errors do not. */
export async function capture(
  source: SourceId,
  label: string,
  url: string,
  init: { method?: "GET" | "POST"; json?: unknown } & FetchOptions = {},
): Promise<Evidence> {
  const method = init.method ?? (init.json === undefined ? "GET" : "POST");
  const doFetch = init.fetchImpl ?? fetch;
  const response = await doFetch(url, {
    method,
    headers: { ...(init.json === undefined ? {} : { "Content-Type": "application/json" }), ...init.headers },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  const body = await response.text();
  const sha256 = sha256Hex(body);
  return {
    id: `${source}:${sha256.slice(0, 12)}`,
    source,
    label,
    method,
    url,
    request: init.json,
    fetchedAt: new Date().toISOString(),
    httpStatus: response.status,
    body,
    sha256,
  };
}

export function parseBody(evidence: Evidence): unknown {
  try {
    return JSON.parse(evidence.body);
  } catch {
    return undefined;
  }
}
