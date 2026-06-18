/**
 * Fixed-window per-client rate limiting backed by Redis.
 *
 * One counter per (client, window) keyed as `mcsearch:rl:<id>:<window>`, where
 * `window` is the current minute bucket. The counter is INCR'd on each hit and
 * expires when the window closes (see lib/cache/redis.ts `cacheIncr`).
 *
 * Degrades open: when Redis is unavailable `cacheIncr` returns null and every
 * request is allowed, so the limiter is a no-op without infra.
 */
import { cacheIncr } from '../cache/redis';

/** Requests allowed per minute, per client. Overridable via RATE_LIMIT_RPM. */
function limitPerMinute(): number {
  const n = Number(process.env.RATE_LIMIT_RPM);
  return Number.isInteger(n) && n > 0 ? n : 60;
}

export interface RateLimitResult {
  /** Whether this request is within the limit. */
  ok: boolean;
  limit: number;
  /** Requests left in the current window (never negative). */
  remaining: number;
  /** Epoch seconds when the current window resets. */
  reset: number;
  /** Seconds until reset — for the Retry-After header when blocked. */
  retryAfter: number;
}

/**
 * Account one request for `clientId` against the per-minute limit. The window
 * is a calendar-aligned minute bucket; `now` (epoch ms) is injected for
 * testability and defaults to the current time.
 */
export async function checkRateLimit(
  clientId: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const limit = limitPerMinute();
  const windowMs = 60_000;
  const window = Math.floor(now / windowMs);
  const reset = (window + 1) * 60;
  const retryAfter = Math.max(1, reset - Math.floor(now / 1000));

  const count = await cacheIncr(`mcsearch:rl:${clientId}:${window}`, 60);
  // Redis unavailable → fall open.
  if (count == null) {
    return { ok: true, limit, remaining: limit, reset, retryAfter };
  }

  const remaining = Math.max(0, limit - count);
  return { ok: count <= limit, limit, remaining, reset, retryAfter };
}
