/**
 * Standard headers for every /api/v1/* endpoint (see project spec).
 *   X-Powered-By, X-Cache, X-Response-Time, Access-Control-Allow-Origin
 */

export type CacheState = 'HIT' | 'MISS';

interface ApiHeaderOptions {
  /** Epoch ms when the request started; used for X-Response-Time. */
  start: number;
  cache?: CacheState;
  contentType?: string;
}

export function apiHeaders(opts: ApiHeaderOptions): Headers {
  const headers = new Headers();
  headers.set('X-Powered-By', 'MCSearch');
  headers.set('X-Cache', opts.cache ?? 'MISS');
  headers.set('X-Response-Time', String(Date.now() - opts.start));
  headers.set('Access-Control-Allow-Origin', '*');
  if (opts.contentType) headers.set('Content-Type', opts.contentType);
  return headers;
}

/** Headers for SSE responses — adds streaming + anti-buffering headers. */
export function sseHeaders(opts: ApiHeaderOptions): Headers {
  const headers = apiHeaders({ ...opts, contentType: undefined });
  headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('Connection', 'keep-alive');
  headers.set('X-Accel-Buffering', 'no'); // disable nginx buffering
  return headers;
}

export function jsonResponse(
  body: unknown,
  status: number,
  opts: ApiHeaderOptions,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders({ ...opts, contentType: 'application/json; charset=utf-8' }),
  });
}
