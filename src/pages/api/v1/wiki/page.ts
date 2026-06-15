/**
 * GET /api/v1/wiki/page — proxy a zh.minecraft.wiki page summary.
 *
 * Query params:
 *   title (required) exact page title (redirects are followed)
 *
 * Returns { title, extract, thumbnail, url } or null when the page does not
 * exist. Negative results are cached too, to avoid hammering upstream. Cached
 * 1800s.
 */
import type { APIRoute } from 'astro';

import { getWikiPage } from '../../../../lib/wiki/client';
import { requireStringParam } from '../../../../lib/http/params';
import { jsonResponse } from '../../../../lib/http/headers';
import { cachedJsonResponse } from '../../../../lib/http/cached-json';

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) => {
  const start = Date.now();
  const parsed = requireStringParam(url, 'title');
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, { start });
  const title = parsed.value;

  try {
    return await cachedJsonResponse({
      key: `mcsearch:wiki:page:${title}`,
      ttl: 1800,
      start,
      compute: () => getWikiPage(title, request.signal),
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Wiki page fetch failed' },
      502,
      { start },
    );
  }
};
