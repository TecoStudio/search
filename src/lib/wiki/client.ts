/**
 * Server-side client for the zh.minecraft.wiki MediaWiki Action API.
 *
 * The frontend never talks to the wiki directly — every request is proxied
 * through our /api/v1/wiki/* routes, which call into these helpers. MediaWiki
 * asks for a descriptive User-Agent, so we always send one.
 *
 * API endpoint: https://zh.minecraft.wiki/api.php
 */

const WIKI_API = 'https://zh.minecraft.wiki/api.php';
const WIKI_PAGE_BASE = 'https://zh.minecraft.wiki/w/';
const USER_AGENT =
  'MCSearch/0.1 (+https://github.com/jhl-hk/mcsearch; ja@jhl.hk)';
const TIMEOUT_MS = 8000;

export interface WikiSearchResult {
  /** Raw page title. */
  title: string;
  /** Title with search highlight as <mark>, safe for v-html. */
  titleSnippet: string;
  /** Cleaned snippet HTML — text only, highlight preserved as <mark>. */
  snippet: string;
  /** Jump URL: https://zh.minecraft.wiki/w/<title>. */
  url: string;
}

export interface WikiPage {
  title: string;
  /** Plain-text intro summary, ≤300 chars. */
  extract: string;
  /** Thumbnail URL, or null when the page has no lead image. */
  thumbnail: string | null;
  /** Canonical page URL. */
  url: string;
}

export interface WikiSuggestion {
  title: string;
  url: string;
}

/** Build the canonical jump URL for a page title. */
export function pageUrl(title: string): string {
  return WIKI_PAGE_BASE + encodeURIComponent(title.replace(/ /g, '_'));
}

/**
 * Call the MediaWiki API with a timeout and our User-Agent. Always requests
 * JSON with formatversion=2 (cleaner shapes); opensearch ignores the latter.
 */
async function wikiFetch(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<any> {
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');

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
    if (!res.ok) throw new Error(`Wiki API responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- snippet cleaning ----------------------------------------------------

const MARK_OPEN = '';
const MARK_CLOSE = '';

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&'); // ampersand last so it can't double-decode
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Turn a MediaWiki search snippet into safe HTML: strip every tag except the
 * `<span class="searchmatch">` highlights, which become `<mark>…</mark>`. All
 * other text is HTML-escaped so the result is safe to render with v-html.
 */
export function cleanSnippet(raw: string): string {
  if (!raw) return '';
  let s = raw.replace(
    /<span class=(?:"|')searchmatch(?:"|')>(.*?)<\/span>/gs,
    MARK_OPEN + '$1' + MARK_CLOSE,
  );
  s = s.replace(/<[^>]*>/g, ''); // drop any remaining tags
  s = decodeEntities(s); // entities -> text
  s = escapeHtml(s); // re-escape so injected text is inert
  s = s.split(MARK_OPEN).join('<mark>').split(MARK_CLOSE).join('</mark>');
  return s.trim();
}

// --- public API ----------------------------------------------------------

/** Full-text search (namespace 0), top 5 results. */
export async function searchWiki(
  q: string,
  signal?: AbortSignal,
): Promise<WikiSearchResult[]> {
  const data = await wikiFetch(
    {
      action: 'query',
      list: 'search',
      srsearch: q,
      srnamespace: '0',
      srlimit: '5',
      srprop: 'snippet|titlesnippet',
    },
    signal,
  );
  const hits: any[] = data?.query?.search ?? [];
  return hits.map((h) => ({
    title: h.title,
    titleSnippet: cleanSnippet(h.titlesnippet ?? '') || escapeHtml(h.title),
    snippet: cleanSnippet(h.snippet ?? ''),
    url: pageUrl(h.title),
  }));
}

/** Fetch a page's intro extract + thumbnail. Returns null if it doesn't exist. */
export async function getWikiPage(
  title: string,
  signal?: AbortSignal,
): Promise<WikiPage | null> {
  const data = await wikiFetch(
    {
      action: 'query',
      prop: 'extracts|pageimages|info',
      exintro: 'true',
      explaintext: 'true',
      exchars: '300',
      titles: title,
      pithumbsize: '200',
      inprop: 'url',
      redirects: '1',
    },
    signal,
  );
  const pages: any[] = data?.query?.pages ?? [];
  const page = pages[0];
  if (!page || page.missing || page.invalid) return null;

  let extract: string = (page.extract ?? '').trim();
  if (extract.length > 300) extract = extract.slice(0, 300).trimEnd() + '…';

  return {
    title: page.title,
    extract,
    thumbnail: page.thumbnail?.source ?? null,
    url: page.fullurl ?? pageUrl(page.title),
  };
}

/** OpenSearch title suggestions (namespace 0), top 5. */
export async function suggestWiki(
  q: string,
  signal?: AbortSignal,
): Promise<WikiSuggestion[]> {
  // opensearch returns the legacy 4-tuple [query, titles, descriptions, urls].
  const data = await wikiFetch(
    {
      action: 'opensearch',
      search: q,
      limit: '5',
      namespace: '0',
    },
    signal,
  );
  const titles: string[] = Array.isArray(data?.[1]) ? data[1] : [];
  const urls: string[] = Array.isArray(data?.[3]) ? data[3] : [];
  return titles.map((title, i) => ({
    title,
    url: urls[i] || pageUrl(title),
  }));
}
