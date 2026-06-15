/**
 * Mod-search whitelist management.
 *
 * Two-track model (per spec): a handful of always-on "big sites" hard-coded
 * here, merged with a dynamic list of community forums curated by the BBSPK
 * project. We never crawl — BBSPK already tracks which forums are alive.
 *
 * The dynamic forum list (mcsearch:mod:sources) is cached in Redis for 6h; the
 * fixed sites are appended on every merge and never cached. On first import we
 * kick off a startup refresh plus a 6h refresh interval (see initSources). When
 * Redis is disabled the list is held in an in-memory memo of the same lifetime,
 * so the app still works without infra (see lib/cache/redis.ts).
 *
 * BBSPK data file (plain JS declaring `const db_forums = [...]`):
 *   https://raw.githubusercontent.com/LYOfficial/BBSPK/main/res/data/forums.js
 */
import vm from 'node:vm';

import { cacheGet, cacheSet } from '../cache/redis';

export interface ModSource {
  /** Short stable id derived from the domain, e.g. 'minebbs'. */
  id: string;
  /** Display name (forum title or big-site label). */
  name: string;
  /** Bare host, e.g. 'minebbs.com' (used for site: and result matching). */
  domain: string;
  /** Bing site operator, e.g. 'site:minebbs.com'. */
  siteQuery: string;
  /** True for the hard-coded big sites. */
  fixed: boolean;
}

const SOURCES_KEY = 'mcsearch:mod:sources';
const SOURCES_TTL = 21600; // 6h, matches the refresh interval

const FORUMS_URL =
  'https://raw.githubusercontent.com/LYOfficial/BBSPK/main/res/data/forums.js';
const USER_AGENT =
  'MCSearch/0.1 (+https://github.com/jhl-hk/mcsearch; ja@jhl.hk)';
const FETCH_TIMEOUT_MS = 10000;

/** Always-included big sites — merged on every request, never cached. */
export const FIXED_SOURCES: ModSource[] = [
  {
    id: 'mcmod',
    name: 'MC百科',
    domain: 'mcmod.info',
    siteQuery: 'site:mcmod.info',
    fixed: true,
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    domain: 'bilibili.com',
    siteQuery: 'site:bilibili.com',
    fixed: true,
  },
  {
    id: 'mcwiki',
    name: 'Minecraft Wiki',
    domain: 'zh.minecraft.wiki',
    siteQuery: 'site:zh.minecraft.wiki',
    fixed: true,
  },
];

// --- domain / id extraction ----------------------------------------------

/** Multi-label public suffixes we may meet in Chinese MC forums. */
const MULTI_SUFFIXES = new Set([
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'ac.cn',
  'com.tw',
  'com.hk',
]);

/** Parse a forum url into its bare host (no scheme, no leading www). */
function hostFromUrl(raw: string): string | null {
  try {
    let h = new URL(raw.trim()).hostname.toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h || null;
  } catch {
    return null;
  }
}

/** Derive a short, stable id from a host: its registrable SLD label. */
function idFromHost(host: string): string {
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 1) return host.replace(/\./g, '-');
  const lastTwo = labels.slice(-2).join('.');
  const sld = MULTI_SUFFIXES.has(lastTwo) ? labels.length - 3 : labels.length - 2;
  return labels[Math.max(0, sld)] ?? labels[0];
}

// --- BBSPK forums.js parsing ---------------------------------------------

interface RawForum {
  title?: string;
  url?: string;
  state?: string;
}

/**
 * Execute the BBSPK data file in a vm sandbox and pull out the `db_forums`
 * array. The file declares it with `const`, which a vm context never exposes as
 * a global, so we append a line — running in the same lexical scope — that
 * copies it onto the sandbox global where we can read it back.
 */
function parseForums(code: string): ModSource[] {
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  try {
    vm.runInContext(
      `${code}\n;globalThis.__db_forums = (typeof db_forums !== 'undefined' ? db_forums : []);`,
      sandbox,
      { timeout: 2000 },
    );
  } catch {
    return [];
  }

  const raw = sandbox.__db_forums;
  if (!Array.isArray(raw)) return [];

  const out: ModSource[] = [];
  const seenDomain = new Set<string>();
  const seenId = new Set<string>();
  for (const f of raw as RawForum[]) {
    if (!f || f.state !== 'up' || !f.url || !f.title) continue;
    const host = hostFromUrl(f.url);
    if (!host || seenDomain.has(host)) continue;
    seenDomain.add(host);

    let id = idFromHost(host);
    if (seenId.has(id)) {
      let n = 2;
      while (seenId.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    seenId.add(id);

    out.push({
      id,
      name: f.title.trim(),
      domain: host,
      siteQuery: `site:${host}`,
      fixed: false,
    });
  }
  return out;
}

async function fetchForums(): Promise<ModSource[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FORUMS_URL, {
      headers: { 'User-Agent': USER_AGENT },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`BBSPK forums responded ${res.status}`);
    return parseForums(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

// --- cache + refresh ------------------------------------------------------

let memoForums: ModSource[] | null = null;
let memoAt = 0;
let inflight: Promise<ModSource[]> | null = null;

/**
 * Force-refresh the dynamic forum list: fetch, parse, write Redis + memo.
 * Concurrent calls share a single in-flight fetch.
 */
export function refreshSources(): Promise<ModSource[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const forums = await fetchForums();
      memoForums = forums;
      memoAt = Date.now();
      await cacheSet(SOURCES_KEY, JSON.stringify(forums), SOURCES_TTL);
      return forums;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Read the dynamic forum list: Redis → fresh memo → refresh. */
async function getForums(): Promise<ModSource[]> {
  const cached = await cacheGet(SOURCES_KEY);
  if (cached) {
    try {
      const arr = JSON.parse(cached);
      if (Array.isArray(arr)) return arr as ModSource[];
    } catch {
      /* fall through to refresh */
    }
  }
  if (memoForums && Date.now() - memoAt < SOURCES_TTL * 1000) return memoForums;
  try {
    return await refreshSources();
  } catch {
    return memoForums ?? [];
  }
}

/** Full source list: fixed big sites + dynamic forums, deduped (fixed wins). */
export async function getSources(): Promise<ModSource[]> {
  const forums = await getForums();
  const seenDomain = new Set(FIXED_SOURCES.map((s) => s.domain));
  const seenId = new Set(FIXED_SOURCES.map((s) => s.id));
  const merged: ModSource[] = [...FIXED_SOURCES];

  for (const f of forums) {
    if (seenDomain.has(f.domain)) continue;
    let id = f.id;
    if (seenId.has(id)) {
      let n = 2;
      while (seenId.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    seenDomain.add(f.domain);
    seenId.add(id);
    merged.push(id === f.id ? f : { ...f, id });
  }
  return merged;
}

/** Narrow a source list by the `source` filter (all | <source id>). */
export function filterSources(all: ModSource[], source: string): ModSource[] {
  if (!source || source === 'all') return all;
  return all.filter((s) => s.id === source);
}

// --- startup + scheduled refresh -----------------------------------------

let scheduler: ReturnType<typeof setInterval> | null = null;

/**
 * Kick off the startup refresh and a 6h refresh interval. Idempotent: safe to
 * call from every route module that touches the whitelist. The interval is
 * unref'd so it never keeps the process alive on its own.
 */
export function initSources(): void {
  if (scheduler) return;
  void refreshSources().catch(() => {});
  scheduler = setInterval(() => {
    void refreshSources().catch(() => {});
  }, SOURCES_TTL * 1000);
  if (typeof scheduler.unref === 'function') scheduler.unref();
}
