/**
 * GET /api/v1/mod/search — search Minecraft mods/resources across a curated
 * whitelist of community forums + big sites (see lib/mod/sources).
 *
 * Query params:
 *   q      (required) keyword
 *   source (optional) all | mcmod | bilibili | <forum id>   (default: all)
 *   page   (optional) page number, 1-based                   (default: 1)
 *
 * Returns { query, source, page, sourcesCount, results: ModResult[] }.
 * Cached 3600s. Headers: X-Cache, X-Sources-Count, X-Powered-By.
 */
import type { APIRoute } from 'astro';

import type { ModSource } from '../../../../lib/mod/sources';
import { getSources, filterSources, initSources } from '../../../../lib/mod/sources';
import { searchMods, BingNotConfiguredError } from '../../../../lib/mod/search';
import { requireStringParam } from '../../../../lib/http/params';
import { apiHeaders, jsonResponse } from '../../../../lib/http/headers';
import { cacheGet, cacheSet } from '../../../../lib/cache/redis';

export const prerender = false;

// Start the whitelist's startup + 6h refresh when this route module loads.
initSources();

const SEARCH_TTL = 3600;
const JSON_CT = 'application/json; charset=utf-8';

export const GET: APIRoute = async ({ url, request }) => {
  const start = Date.now();

  const parsed = requireStringParam(url, 'q');
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, { start });
  const q = parsed.value;

  const source = (url.searchParams.get('source')?.trim() || 'all').toLowerCase();

  let page = Number(url.searchParams.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1) page = 1;

  // 1-2. Build the whitelist, then narrow it to the requested source.
  let all: ModSource[];
  try {
    all = await getSources();
  } catch {
    all = [];
  }
  const sources = filterSources(all, source);
  if (sources.length === 0) {
    return jsonResponse({ error: `Unknown source: ${source}` }, 400, { start });
  }

  // 3. Cache lookup. Page 1 uses the canonical key; later pages get a suffix.
  const cacheKey =
    `mcsearch:mod:search:${q.toLowerCase()}:${source}` +
    (page > 1 ? `:p${page}` : '');
  const cached = await cacheGet(cacheKey);
  if (cached != null) {
    const headers = apiHeaders({ start, cache: 'HIT', contentType: JSON_CT });
    headers.set('X-Sources-Count', String(sources.length));
    return new Response(cached, { status: 200, headers });
  }

  // 4-7. Query Bing, group results, cache, return.
  try {
    const data = await searchMods({ q, sources, source, page, signal: request.signal });
    const body = JSON.stringify(data);
    await cacheSet(cacheKey, body, SEARCH_TTL);
    const headers = apiHeaders({ start, cache: 'MISS', contentType: JSON_CT });
    headers.set('X-Sources-Count', String(sources.length));
    return new Response(body, { status: 200, headers });
  } catch (err) {
    if (err instanceof BingNotConfiguredError) {
      return jsonResponse({ error: err.message }, 503, { start });
    }
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Mod search failed' },
      502,
      { start },
    );
  }
};
