/**
 * CurseForge native search.
 *
 * Hits the CurseForge v1 mods search API (gameId 432 = Minecraft) and maps each
 * mod onto the shared ModResult shape. Unlike Modrinth, CurseForge requires an
 * API key (CURSEFORGE_API_KEY); when it's missing we throw
 * CurseForgeNotConfiguredError so the route can answer 503 (and so `all`-mode
 * search can skip this source — see lib/mod/search.ts).
 *
 *   GET https://api.curseforge.com/v1/mods/search
 *       ?gameId=432&searchFilter=<q>&pageSize=20&index=<n>&sortField=2&sortOrder=desc
 *   header: x-api-key: <CURSEFORGE_API_KEY>
 */
import { createHash } from 'node:crypto';

import type { ModResult } from './search';

const API = 'https://api.curseforge.com/v1/mods/search';
const MINECRAFT_GAME_ID = 432;
const SORT_POPULARITY = 2;
const PAGE_SIZE = 20;
const TIMEOUT_MS = 8000;

/** Thrown when CURSEFORGE_API_KEY is missing, so the route can answer 503. */
export class CurseForgeNotConfiguredError extends Error {
  constructor() {
    super('CurseForge API key not configured (set CURSEFORGE_API_KEY)');
    this.name = 'CurseForgeNotConfiguredError';
  }
}

interface CurseForgeMod {
  name?: string;
  summary?: string;
  downloadCount?: number;
  logo?: { thumbnailUrl?: string } | null;
  links?: { websiteUrl?: string } | null;
  authors?: { name?: string }[];
  categories?: { name?: string }[];
}

export async function searchCurseForge(
  q: string,
  page: number,
  signal?: AbortSignal,
): Promise<ModResult[]> {
  const key = process.env.CURSEFORGE_API_KEY;
  if (!key) throw new CurseForgeNotConfiguredError();

  const url = new URL(API);
  url.searchParams.set('gameId', String(MINECRAFT_GAME_ID));
  url.searchParams.set('searchFilter', q);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('index', String((Math.max(1, page) - 1) * PAGE_SIZE));
  url.searchParams.set('sortField', String(SORT_POPULARITY));
  url.searchParams.set('sortOrder', 'desc');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': key, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`CurseForge API responded ${res.status}`);
    const data = await res.json();
    const mods: CurseForgeMod[] = Array.isArray(data?.data) ? data.data : [];
    return mods.map(toResult).filter((r): r is ModResult => r !== null);
  } finally {
    clearTimeout(timer);
  }
}

function toResult(mod: CurseForgeMod): ModResult | null {
  const url = mod?.links?.websiteUrl;
  if (!url) return null;
  const r: ModResult = {
    id: createHash('sha1').update(url).digest('hex').slice(0, 16),
    name: String(mod.name ?? ''),
    description: String(mod.summary ?? ''),
    source: 'curseforge',
    sourceName: 'CurseForge',
    url,
    displayUrl: url,
  };
  if (mod.logo?.thumbnailUrl) r.thumbnail = mod.logo.thumbnailUrl;
  if (typeof mod.downloadCount === 'number') r.downloads = mod.downloadCount;
  const author = mod.authors?.[0]?.name;
  if (author) r.author = author;
  const categories = (mod.categories ?? [])
    .map((c) => c?.name)
    .filter((n): n is string => !!n);
  if (categories.length) r.categories = categories;
  return r;
}
