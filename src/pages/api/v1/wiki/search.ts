/**
 * GET /api/v1/wiki/search — proxy zh.minecraft.wiki full-text search.
 *
 * Query params:
 *   q (required) search keyword
 *
 * Returns { query, results: [{ title, titleSnippet, snippet, url }] }.
 * Snippets are cleaned to text + <mark> highlights. Cached 600s.
 */
import type { APIRoute } from 'astro';

import { searchWiki } from '../../../../lib/wiki/client';
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
      key: `mcsearch:wiki:search:${q.toLowerCase()}`,
      ttl: 600,
      start,
      compute: async () => ({
        query: q,
        results: await searchWiki(q, request.signal),
      }),
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Wiki search failed' },
      502,
      { start },
    );
  }
};
