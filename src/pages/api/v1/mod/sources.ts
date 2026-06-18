/**
 * GET /api/v1/mod/sources — list the available mod-search sources.
 *
 * Returns the fixed big sites plus the dynamic BBSPK forum whitelist so clients
 * (and the Playground) can discover valid `source` ids for /api/v1/mod/search.
 * The internal `siteQuery` is omitted.
 *
 * Returns { count, sources: [{ id, name, domain, provider, fixed }] }.
 * Cached 300s. Headers: X-Cache, X-Powered-By.
 */
import type { APIRoute } from 'astro';

import { getSources, initSources } from '../../../../lib/mod/sources';
import { errorResponse } from '../../../../lib/http/headers';
import { cachedJsonResponse } from '../../../../lib/http/cached-json';

export const prerender = false;

// Start the whitelist's startup + 6h refresh when this route module loads.
initSources();

const SOURCES_TTL = 300;

export const GET: APIRoute = async () => {
  const start = Date.now();
  try {
    return await cachedJsonResponse({
      key: 'mcsearch:mod:sources:list',
      ttl: SOURCES_TTL,
      start,
      compute: async () => {
        const all = await getSources();
        return {
          count: all.length,
          sources: all.map(({ id, name, domain, provider, fixed }) => ({
            id,
            name,
            domain,
            provider,
            fixed,
          })),
        };
      },
    });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : 'Failed to list sources',
      502,
      { start },
    );
  }
};
