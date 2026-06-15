/**
 * Modrinth-compatible ("Labrinth") native search.
 *
 * Modrinth exposes a public v2 search API (no key). BBSMC (bbsmc.net) is a
 * Modrinth fork serving the exact same API shape, so both share this client —
 * only the API/site base URLs and the source id/name differ. Each hit is mapped
 * onto the shared ModResult, filling the optional mod-metadata fields
 * (downloads / author / categories / projectType) that the Bing path leaves
 * blank. See lib/mod/search.ts for how this is dispatched per-source.
 *
 *   GET <apiBase>?query=<q>&limit=20&offset=<n>
 *   project page: <siteBase>/<project_type>/<slug>
 */
import { createHash } from 'node:crypto';

import type { ModResult } from './search';

/** A Modrinth-compatible backend (Modrinth itself or a fork like BBSMC). */
interface LabrinthSite {
  /** v2 search endpoint, e.g. 'https://api.modrinth.com/v2/search'. */
  apiBase: string;
  /** Site base for project pages, e.g. 'https://modrinth.com'. */
  siteBase: string;
  /** ModSource id this backend maps to. */
  source: string;
  /** Display name. */
  sourceName: string;
}

const MODRINTH: LabrinthSite = {
  apiBase: 'https://api.modrinth.com/v2/search',
  siteBase: 'https://modrinth.com',
  source: 'modrinth',
  sourceName: 'Modrinth',
};

const BBSMC: LabrinthSite = {
  apiBase: 'https://api.bbsmc.net/v2/search',
  siteBase: 'https://bbsmc.net',
  source: 'bbsmc',
  sourceName: 'BBSMC',
};

const USER_AGENT =
  'MCSearch/0.1 (+https://github.com/jhl-hk/mcsearch; ja@jhl.hk)';
const PAGE_SIZE = 20;
const TIMEOUT_MS = 8000;

interface LabrinthHit {
  slug?: string;
  title?: string;
  description?: string;
  categories?: string[];
  project_type?: string;
  downloads?: number;
  icon_url?: string | null;
  author?: string;
}

async function searchLabrinth(
  site: LabrinthSite,
  q: string,
  page: number,
  signal?: AbortSignal,
): Promise<ModResult[]> {
  const url = new URL(site.apiBase);
  url.searchParams.set('query', q);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String((Math.max(1, page) - 1) * PAGE_SIZE));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`${site.sourceName} API responded ${res.status}`);
    }
    const data = await res.json();
    const hits: LabrinthHit[] = Array.isArray(data?.hits) ? data.hits : [];
    return hits
      .map((h) => toResult(site, h))
      .filter((r): r is ModResult => r !== null);
  } finally {
    clearTimeout(timer);
  }
}

function toResult(site: LabrinthSite, hit: LabrinthHit): ModResult | null {
  if (!hit?.slug) return null;
  const type = hit.project_type || 'mod';
  const url = `${site.siteBase}/${type}/${hit.slug}`;
  const r: ModResult = {
    id: createHash('sha1').update(url).digest('hex').slice(0, 16),
    name: String(hit.title ?? hit.slug),
    description: String(hit.description ?? ''),
    source: site.source,
    sourceName: site.sourceName,
    url,
    displayUrl: url,
    projectType: type,
  };
  if (hit.icon_url) r.thumbnail = hit.icon_url;
  if (typeof hit.downloads === 'number') r.downloads = hit.downloads;
  if (hit.author) r.author = hit.author;
  if (Array.isArray(hit.categories) && hit.categories.length) {
    r.categories = hit.categories;
  }
  return r;
}

export function searchModrinth(q: string, page: number, signal?: AbortSignal) {
  return searchLabrinth(MODRINTH, q, page, signal);
}

export function searchBBSMC(q: string, page: number, signal?: AbortSignal) {
  return searchLabrinth(BBSMC, q, page, signal);
}
