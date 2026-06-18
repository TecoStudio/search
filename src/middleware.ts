/**
 * API gateway middleware — applies uniformly to every /api/* request:
 *
 *   1. CORS preflight: answers OPTIONS with 204 + permissive CORS headers.
 *   2. Rate limiting: per-client fixed-window limit on /api/v1/* (health is
 *      exempt). Falls open when Redis is unavailable. Adds X-RateLimit-* headers
 *      to allowed responses and returns 429 + Retry-After when exceeded.
 *
 * Non-/api/* requests pass straight through.
 */
import { defineMiddleware } from 'astro:middleware';

import { checkRateLimit } from './lib/http/rate-limit';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

/** Derive a stable client id, honouring a reverse proxy's X-Forwarded-For. */
function clientId(request: Request, clientAddress: string): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return clientAddress || 'unknown';
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;

  if (!url.pathname.startsWith('/api/')) return next();

  // 1. CORS preflight — short-circuit before any handler runs.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 2. Rate limiting — only public v1 endpoints, health excluded.
  const limited =
    url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1/health';
  if (!limited) return next();

  // clientAddress can throw on adapters that don't expose it; treat as unknown.
  let address = 'unknown';
  try {
    address = context.clientAddress;
  } catch {
    /* keep unknown */
  }

  const rl = await checkRateLimit(clientId(request, address));
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Retry-After': String(rl.retryAfter),
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rl.reset),
        },
      },
    );
  }

  const response = await next();
  response.headers.set('X-RateLimit-Limit', String(rl.limit));
  response.headers.set('X-RateLimit-Remaining', String(rl.remaining));
  response.headers.set('X-RateLimit-Reset', String(rl.reset));
  return response;
});
