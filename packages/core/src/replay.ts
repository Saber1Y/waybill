/**
 * Record-and-replay for real HTTP traffic. Fixtures are responses captured from mainnet sources on a
 * stated date, not hand-written data, so tests check Waybill against what the services really return.
 */
export interface RecordedExchange {
  method: string;
  url: string;
  body: string | null;
  status: number;
  responseBody: string;
}

export interface Recording {
  case: string;
  description: string;
  recordedAt: string;
  input: { depositAddress: string; txHash?: string };
  exchanges: RecordedExchange[];
}

function keyOf(method: string, url: string, body: string | null): string {
  return `${method} ${url} ${body ?? ""}`;
}

export function recordingFetch(exchanges: RecordedExchange[]): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    const response = await fetch(input, init);
    const responseBody = await response.text();
    exchanges.push({ method, url, body, status: response.status, responseBody });
    return new Response(responseBody, { status: response.status });
  };
}

/** Serves recorded responses. An unrecorded request fails loudly instead of reaching the network. */
export function replayFetch(recording: Recording): typeof fetch {
  const byKey = new Map(recording.exchanges.map((e) => [keyOf(e.method, e.url, e.body), e]));
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    const hit = byKey.get(keyOf(method, url, body));
    if (!hit) throw new Error(`No recorded response for ${method} ${url}`);
    return new Response(hit.responseBody, { status: hit.status });
  };
}
