/**
 * GET /api/v1/server/banner — 800×200 PNG banner of a server's status.
 *
 * Pings in real time, renders with Satori, caches the PNG in Redis (60s).
 * Offline servers still produce a banner.
 */
import type { APIRoute } from 'astro';

import { pingServer } from '../../../../lib/mc/ping';
import type { ServerStatus } from '../../../../lib/mc/types';
import { parseServerParams } from '../../../../lib/http/params';
import { apiHeaders, jsonResponse } from '../../../../lib/http/headers';
import { cacheGetBuffer, cacheSetBuffer } from '../../../../lib/cache/redis';
import { generateBanner } from '../../../../lib/banner/generate';

export const prerender = false;

const TTL = 60;

export const GET: APIRoute = async ({ request, url }) => {
  const start = Date.now();
  const parsed = parseServerParams(url);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, { start });
  const { host, port, edition } = parsed.params;

  const key = `mcsearch:server:banner:${host}:${port ?? 'auto'}`;

  const cached = await cacheGetBuffer(key);
  if (cached) return pngResponse(cached, start, 'HIT');

  let status: ServerStatus | null = null;
  try {
    status = await pingServer(host, edition, { port, signal: request.signal });
  } catch {
    status = null; // offline → still render a banner
  }

  let png: Buffer;
  try {
    png = await generateBanner({
      host,
      port: status?.port ?? port ?? (edition === 'bedrock' ? 19132 : 25565),
      status,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
      { start },
    );
  }

  await cacheSetBuffer(key, png, TTL);
  return pngResponse(png, start, 'MISS');
};

function pngResponse(png: Buffer, start: number, cache: 'HIT' | 'MISS') {
  const headers = apiHeaders({ start, cache, contentType: 'image/png' });
  headers.set('Cache-Control', `public, max-age=${TTL}`);
  return new Response(new Uint8Array(png), { status: 200, headers });
}
