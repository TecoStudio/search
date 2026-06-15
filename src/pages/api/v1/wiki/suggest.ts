/**
 * GET /api/v1/wiki/suggest — proxy zh.minecraft.wiki title autocomplete.
 *
 * Query params:
 *   q (required) search keyword
 *
 * Returns { suggestions: [{ title, url }] } (max 5). Cached 300s.
 */
import type { APIRoute } from 'astro';

import { suggestWiki } from '../../../../lib/wiki/client';
import { requireStringParam } from '../../../../lib/http/params';
import { jsonResponse } from '../../../../lib/http/headers';
import { cachedJsonResponse } from '../../../../lib/http/cached-json';

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) => {
  const start = Date.now();
  const parsed = requireStringParam(url, 'q');
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, { start });
  const q = parsed.value;

  try {
    return await cachedJsonResponse({
      key: `mcsearch:wiki:suggest:${q.toLowerCase()}`,
      ttl: 300,
      start,
      compute: async () => ({ suggestions: await suggestWiki(q, request.signal) }),
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Wiki suggest failed' },
      502,
      { start },
    );
  }
};
