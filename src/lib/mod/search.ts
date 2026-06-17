/**
 * Mod search: dispatch the active whitelist across its search backends and merge
 * the results. Site:-search sources go through one Bing batch (described below);
 * Modrinth, BBSMC (a Modrinth fork) and CurseForge use their native search APIs
 * (see ./modrinth, ./curseforge). Every backend runs in parallel and a failing
 * one is dropped unless it's the only source requested — see searchMods.
 *
 * Bing query construction (per spec):
 *   - keyword is phrase-quoted for exact matching
 *   - a single source            → `site:<domain> "<q>"`
 *   - multiple sources           → `"<q>" (site:d1 OR site:d2 OR ...)`
 *   - bilibili gets its own query with an extra "minecraft" keyword to cut
 *     unrelated videos: `site:bilibili.com minecraft "<q>"`
 *
 * Because bilibili needs a different query shape it can't share the combined
 * OR query, so we run one combined query for the rest plus one per special
 * source, in parallel (Promise.all), and classify each returned result by its
 * host. Search engine: Bing, scraped via headless Chromium (see ./browser) —
 * no API key. We navigate bing.com/search and parse the #b_results list, so a
 * single results page yields ~10 organic hits (vs the API's 20); pagination
 * still works through Bing's 1-based `first` offset.
 */
import { createHash } from 'node:crypto';

import type { ModSource } from './sources';
import { searchModrinth, searchBBSMC } from './modrinth';
import { searchCurseForge } from './curseforge';
import { withPage, initBrowserShutdown } from './browser';

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
  /** Thumbnail / icon, when the source provides one. */
  thumbnail?: string;
  /** Breadcrumb URL from Bing (native providers reuse the canonical url). */
  displayUrl: string;
  /** Download count — set by native providers (Modrinth / CurseForge). */
  downloads?: number;
  /** Author / owner — set by native providers. */
  author?: string;
  /** Category tags — set by native providers. */
  categories?: string[];
  /** Project type, e.g. mod / modpack / resourcepack — Modrinth only. */
  projectType?: string;
}

export interface ModSearchResponse {
  query: string;
  source: string;
  page: number;
  sourcesCount: number;
  results: ModResult[];
}

const BING_SEARCH_URL = 'https://www.bing.com/search';
const BILIBILI_DOMAIN = 'bilibili.com';
/** Organic results per Bing SERP — used to map a page number to the `first` offset. */
const PAGE_SIZE = 10;
const TIMEOUT_MS = 12000;

// Ensure Chromium is torn down on server shutdown (idempotent).
initBrowserShutdown();

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

/**
 * Run one Bing web-search query by scraping bing.com/search in headless
 * Chromium, returning items shaped like the old API's webPages values
 * ({ url, name, snippet }) so the downstream classify/dedup code is unchanged.
 */
async function bingSearch(
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<any[]> {
  const url = new URL(BING_SEARCH_URL);
  url.searchParams.set('q', query);
  // Bing's `first` is the 1-based index of the first result on the page.
  url.searchParams.set('first', String((Math.max(1, page) - 1) * PAGE_SIZE + 1));
  url.searchParams.set('setlang', 'zh-CN');
  url.searchParams.set('mkt', 'zh-CN');

  return withPage(async (page) => {
    if (signal) {
      if (signal.aborted) throw new Error('aborted');
      signal.addEventListener('abort', () => void page.close().catch(() => {}), {
        once: true,
      });
    }
    await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    });

    // Parse the organic results list. Title + link come from `h2 > a`; the
    // snippet from the caption paragraph (with a couple of known fallbacks).
    return page.$$eval('#b_results > li.b_algo', (nodes) =>
      nodes
        .map((li) => {
          const a = li.querySelector('h2 > a') as HTMLAnchorElement | null;
          const href = a?.href ?? '';
          const name = a?.textContent?.trim() ?? '';
          const snippetEl =
            li.querySelector('.b_caption p') ||
            li.querySelector('.b_algoSlug') ||
            li.querySelector('.b_caption');
          const snippet = snippetEl?.textContent?.trim() ?? '';
          return { url: href, name, snippet, displayUrl: href };
        })
        .filter((r) => r.url),
    );
  });
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

/**
 * Run every Bing plan for the bing-provider sources and classify each web
 * result back onto its source. Dedup within this batch by url; cross-provider
 * dedup happens when the tasks are merged in searchMods.
 */
async function bingTask(
  q: string,
  sources: ModSource[],
  page: number,
  signal?: AbortSignal,
): Promise<ModResult[]> {
  const batches = await Promise.all(
    buildPlans(q, sources).map((p) =>
      bingSearch(p.q, page, signal).then((items) => ({
        items,
        sources: p.sources,
      })),
    ),
  );

  const out: ModResult[] = [];
  const seen = new Set<string>();
  for (const { items, sources: planSources } of batches) {
    for (const item of items) {
      const url = String(item?.url ?? '');
      if (!url || seen.has(url)) continue;
      const src = matchSource(url, planSources);
      if (!src) continue;
      seen.add(url);
      out.push(toResult(item, src));
    }
  }
  return out;
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

  // Split by provider: one Bing batch covers all site:-search sources, while
  // Modrinth / CurseForge each get a native API call. (An absent provider —
  // possible from stale cached forum data — counts as bing.)
  const bingSources = sources.filter((s) => (s.provider ?? 'bing') === 'bing');
  const tasks: Promise<ModResult[]>[] = [];
  if (bingSources.length) tasks.push(bingTask(q, bingSources, page, signal));
  for (const s of sources) {
    if (s.provider === 'modrinth') tasks.push(searchModrinth(q, page, signal));
    else if (s.provider === 'bbsmc') tasks.push(searchBBSMC(q, page, signal));
    else if (s.provider === 'curseforge') {
      tasks.push(searchCurseForge(q, page, signal));
    }
  }

  // Run every backend; a single provider failing (e.g. a missing CurseForge key
  // in `all` mode) just drops that source. Only when nothing succeeded do we
  // surface the first error, so a lone failing source still yields a 503/502.
  const settled = await Promise.allSettled(tasks);
  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<ModResult[]> => r.status === 'fulfilled',
  );
  if (fulfilled.length === 0) {
    const rejected = settled.find((r) => r.status === 'rejected');
    if (rejected) throw (rejected as PromiseRejectedResult).reason;
  }

  const results: ModResult[] = [];
  const seenUrl = new Set<string>();
  for (const r of fulfilled) {
    for (const item of r.value) {
      if (!item.url || seenUrl.has(item.url)) continue;
      seenUrl.add(item.url);
      results.push(item);
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
