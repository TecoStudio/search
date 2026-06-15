/**
 * Mod search: turn the active whitelist into Bing queries, then group the
 * results back onto their source.
 *
 * Query construction (per spec):
 *   - keyword is phrase-quoted for exact matching
 *   - a single source            → `site:<domain> "<q>"`
 *   - multiple sources           → `"<q>" (site:d1 OR site:d2 OR ...)`
 *   - bilibili gets its own query with an extra "minecraft" keyword to cut
 *     unrelated videos: `site:bilibili.com minecraft "<q>"`
 *
 * Because bilibili needs a different query shape it can't share the combined
 * OR query, so we run one combined query for the rest plus one per special
 * source, in parallel (Promise.all), and classify each returned result by its
 * host. Search engine: Bing Web Search API (Azure). Credentials come from env:
 *   BING_SEARCH_KEY       (required) Ocp-Apim-Subscription-Key
 *   BING_SEARCH_ENDPOINT  (optional) defaults to the v7 web-search endpoint
 */
import { createHash } from 'node:crypto';

import type { ModSource } from './sources';

export interface ModResult {
  /** Hash of the result URL — stable id. */
  id: string;
  /** Page title. */
  name: string;
  /** Snippet / summary. */
  description: string;
  /** Source id. */
  source: string;
  /** Source display name. */
  sourceName: string;
  /** Original link. */
  url: string;
  /** Thumbnail, when Bing returns one. */
  thumbnail?: string;
  /** Breadcrumb URL from Bing. */
  displayUrl: string;
}

export interface ModSearchResponse {
  query: string;
  source: string;
  page: number;
  sourcesCount: number;
  results: ModResult[];
}

/** Thrown when BING_SEARCH_KEY is missing, so the route can answer 503. */
export class BingNotConfiguredError extends Error {
  constructor() {
    super('Bing Search API key not configured (set BING_SEARCH_KEY)');
    this.name = 'BingNotConfiguredError';
  }
}

const BING_DEFAULT_ENDPOINT = 'https://api.bing.microsoft.com/v7.0/search';
const BILIBILI_DOMAIN = 'bilibili.com';
const PAGE_SIZE = 20;
const TIMEOUT_MS = 8000;

/** Phrase-quote the keyword; collapse stray quotes so the operator survives. */
function quoted(q: string): string {
  return `"${q.replace(/"/g, ' ').trim()}"`;
}

/** A single Bing query plus the sources its results should be matched against. */
interface QueryPlan {
  q: string;
  sources: ModSource[];
}

function buildPlans(q: string, sources: ModSource[]): QueryPlan[] {
  const phrase = quoted(q);
  const bili = sources.filter((s) => s.domain === BILIBILI_DOMAIN);
  const rest = sources.filter((s) => s.domain !== BILIBILI_DOMAIN);
  const plans: QueryPlan[] = [];

  if (rest.length === 1) {
    plans.push({ q: `${rest[0].siteQuery} ${phrase}`, sources: rest });
  } else if (rest.length > 1) {
    const ors = rest.map((s) => s.siteQuery).join(' OR ');
    plans.push({ q: `${phrase} (${ors})`, sources: rest });
  }
  for (const b of bili) {
    plans.push({ q: `${b.siteQuery} minecraft ${phrase}`, sources: [b] });
  }
  return plans;
}

/** Run one Bing web-search query, returning the raw webPages items. */
async function bingSearch(
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<any[]> {
  const key = process.env.BING_SEARCH_KEY;
  if (!key) throw new BingNotConfiguredError();
  const endpoint = process.env.BING_SEARCH_ENDPOINT || BING_DEFAULT_ENDPOINT;

  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(PAGE_SIZE));
  url.searchParams.set('offset', String((Math.max(1, page) - 1) * PAGE_SIZE));
  url.searchParams.set('mkt', 'zh-CN');
  url.searchParams.set('responseFilter', 'Webpages');
  url.searchParams.set('textDecorations', 'false');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': key, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Bing API responded ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.webPages?.value) ? data.webPages.value : [];
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Match a result URL to one of the candidate sources by host. */
function matchSource(url: string, sources: ModSource[]): ModSource | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const s of sources) {
    if (host === s.domain || host.endsWith('.' + s.domain)) return s;
  }
  return null;
}

function toResult(item: any, source: ModSource): ModResult {
  const url = String(item?.url ?? '');
  const r: ModResult = {
    id: createHash('sha1').update(url).digest('hex').slice(0, 16),
    name: String(item?.name ?? ''),
    description: String(item?.snippet ?? ''),
    source: source.id,
    sourceName: source.name,
    url,
    displayUrl: String(item?.displayUrl ?? url),
  };
  if (item?.thumbnailUrl) r.thumbnail = String(item.thumbnailUrl);
  return r;
}

export async function searchMods(opts: {
  q: string;
  /** Sources already narrowed to the requested `source` filter. */
  sources: ModSource[];
  /** Raw filter value, echoed back in the response. */
  source: string;
  page: number;
  signal?: AbortSignal;
}): Promise<ModSearchResponse> {
  const { q, sources, source, page, signal } = opts;

  const batches = await Promise.all(
    buildPlans(q, sources).map((p) =>
      bingSearch(p.q, page, signal).then((items) => ({
        items,
        sources: p.sources,
      })),
    ),
  );

  const results: ModResult[] = [];
  const seenUrl = new Set<string>();
  for (const { items, sources: planSources } of batches) {
    for (const item of items) {
      const url = String(item?.url ?? '');
      if (!url || seenUrl.has(url)) continue;
      const src = matchSource(url, planSources);
      if (!src) continue;
      seenUrl.add(url);
      results.push(toResult(item, src));
    }
  }

  return {
    query: q,
    source,
    page,
    sourcesCount: sources.length,
    results,
  };
}
