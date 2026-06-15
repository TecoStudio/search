/**
 * Read-through cache helper for JSON GET endpoints.
 *
 * On a cache hit the stored body is returned verbatim with X-Cache: HIT; on a
 * miss `compute()` runs, its result is cached for `ttl` seconds and returned
 * with X-Cache: MISS. Caching degrades to a no-op when Redis is unavailable
 * (see lib/cache/redis.ts), so this is safe to use with or without infra.
 */
import { cacheGet, cacheSet } from '../cache/redis';
import { apiHeaders } from './headers';

const JSON_CT = 'application/json; charset=utf-8';

export interface CachedJsonOptions<T> {
  key: string;
  ttl: number;
  /** Epoch ms when the request started; used for X-Response-Time. */
  start: number;
  compute: () => Promise<T>;
}

export async function cachedJsonResponse<T>(
  opts: CachedJsonOptions<T>,
): Promise<Response> {
  const { key, ttl, start, compute } = opts;

  const cached = await cacheGet(key);
  if (cached != null) {
    return new Response(cached, {
      status: 200,
      headers: apiHeaders({ start, cache: 'HIT', contentType: JSON_CT }),
    });
  }

  const data = await compute();
  const body = JSON.stringify(data);
  await cacheSet(key, body, ttl);
  return new Response(body, {
    status: 200,
    headers: apiHeaders({ start, cache: 'MISS', contentType: JSON_CT }),
  });
}
