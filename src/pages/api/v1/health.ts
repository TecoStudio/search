/**
 * GET /api/v1/health — liveness/readiness probe target.
 *
 * Intentionally cheap: no upstream calls, no rendering. Used by the k8s
 * Deployment's readiness/liveness probes.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
