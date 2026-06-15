/**
 * GET /api/v1/server/icon — the server's favicon as a PNG (64×64).
 *
 * Returns the server's own icon when available, otherwise a placeholder.
 */
import type { APIRoute } from 'astro';
import { Resvg } from '@resvg/resvg-js';

import { pingServer } from '../../../../lib/mc/ping';
import { parseServerParams } from '../../../../lib/http/params';
import { apiHeaders, jsonResponse } from '../../../../lib/http/headers';
import { cacheGetBuffer, cacheSetBuffer } from '../../../../lib/cache/redis';

export const prerender = false;

const TTL = 60;
const DATA_URL_RE = /^data:image\/png;base64,(.+)$/;

let placeholder: Buffer | null = null;
function placeholderIcon(): Buffer {
  if (!placeholder) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
      '<rect width="64" height="64" rx="10" fill="#3f8f3f"/></svg>';
    placeholder = Buffer.from(new Resvg(svg).render().asPng());
  }
  return placeholder;
}

export const GET: APIRoute = async ({ request, url }) => {
  const start = Date.now();
  const parsed = parseServerParams(url);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, { start });
  const { host, port, edition } = parsed.params;

  const key = `mcsearch:server:icon:${host}:${port ?? 'auto'}`;

  const cached = await cacheGetBuffer(key);
  if (cached) return pngResponse(cached, start, 'HIT');

  let png: Buffer;
  try {
    const status = await pingServer(host, edition, {
      port,
      signal: request.signal,
    });
    const match = status.favicon?.match(DATA_URL_RE);
    png = match ? Buffer.from(match[1], 'base64') : placeholderIcon();
  } catch {
    png = placeholderIcon();
  }

  await cacheSetBuffer(key, png, TTL);
  return pngResponse(png, start, 'MISS');
};

function pngResponse(png: Buffer, start: number, cache: 'HIT' | 'MISS') {
  const headers = apiHeaders({ start, cache, contentType: 'image/png' });
  headers.set('Cache-Control', `public, max-age=${TTL}`);
  return new Response(new Uint8Array(png), { status: 200, headers });
}
