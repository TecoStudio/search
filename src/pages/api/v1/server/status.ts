/**
 * GET /api/v1/server/status — SSE stream of a Minecraft server's status.
 *
 * Query params:
 *   host    (required) server hostname or IP
 *   port    (optional) overrides SRV lookup / default port
 *   edition java | bedrock | auto   (default: java)
 *
 * Events: step (dns|connecting|handshake), result (full JSON), error.
 */
import type { APIRoute } from 'astro';

import { pingServer } from '../../../../lib/mc/ping';
import { parseServerParams } from '../../../../lib/http/params';
import { jsonResponse, sseHeaders } from '../../../../lib/http/headers';
import { createSseResponse } from '../../../../lib/http/sse';

export const prerender = false;

export const GET: APIRoute = ({ request, url }) => {
  const start = Date.now();
  const parsed = parseServerParams(url);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400, { start });
  }
  const { host, port, edition } = parsed.params;

  const headers = sseHeaders({ start, cache: 'MISS' });

  return createSseResponse(async (sse) => {
    try {
      const result = await pingServer(host, edition, {
        port,
        onStep: (step) => sse.send('step', step),
        signal: request.signal,
      });
      sse.send('result', result);
    } catch (err) {
      if (request.signal.aborted) return; // client went away
      sse.send('error', {
        host,
        port: port ?? null,
        edition,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, headers);
};
