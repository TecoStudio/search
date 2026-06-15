/**
 * GET /api/internal/refresh-sources — force-refresh the mod-search whitelist.
 *
 * Re-fetches the BBSPK forum list, re-parses it and overwrites the Redis cache
 * (mcsearch:mod:sources). Intended for internal/manual use; the list also
 * refreshes on a 6h interval on its own (see lib/mod/sources).
 *
 * Returns { ok, forums, fixed, total }.
 */
import type { APIRoute } from 'astro';

import { refreshSources, FIXED_SOURCES } from '../../../lib/mod/sources';
import { jsonResponse } from '../../../lib/http/headers';

export const prerender = false;

export const GET: APIRoute = async () => {
  const start = Date.now();
  try {
    const forums = await refreshSources();
    return jsonResponse(
      {
        ok: true,
        forums: forums.length,
        fixed: FIXED_SOURCES.length,
        total: forums.length + FIXED_SOURCES.length,
      },
      200,
      { start },
    );
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Refresh failed' },
      502,
      { start },
    );
  }
};
