/**
 * GET /api/internal/refresh-sources — force-refresh the mod-search whitelist.
 *
 * Re-fetches the BBSPK forum list, re-parses it and overwrites the Redis cache
 * (mcsearch:mod:sources). Intended for internal/manual use; the list also
 * refreshes on a 6h interval on its own (see lib/mod/sources).
 *
 * When INTERNAL_TOKEN is set, requires `Authorization: Bearer <token>`; when
 * unset the endpoint stays open (no breaking change for existing callers).
 *
 * Returns { ok, forums, fixed, total }.
 */
import type { APIRoute } from 'astro';

import { refreshSources, FIXED_SOURCES } from '../../../lib/mod/sources';
import { jsonResponse, errorResponse } from '../../../lib/http/headers';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const start = Date.now();

  const token = process.env.INTERNAL_TOKEN;
  if (token) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${token}`) {
      return errorResponse('Unauthorized', 401, { start });
    }
  }

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
