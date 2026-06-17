/**
 * Headless Chromium for the Bing web-search scraper (see ./search).
 *
 * The browser is a lazily-launched singleton reused across requests — launching
 * one per request would blow the pod's memory limit. Pages are handed out via
 * withPage() behind a small concurrency semaphore so a burst of searches can't
 * spawn an unbounded number of tabs.
 *
 * Chromium runs under a locked-down PodSecurity context (non-root, all caps
 * dropped, tiny /dev/shm), so it must launch with --no-sandbox and friends.
 * playwright-core ships no browser binary; CHROMIUM_PATH points at the apt /
 * brew installed Chromium (defaults to the Debian path baked into the image).
 */
import { chromium, type Browser, type Page } from 'playwright-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--mute-audio',
];
// A desktop UA so Bing serves the standard #b_results layout we parse.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// Cap concurrent tabs to stay within the pod memory budget.
const MAX_PAGES = 3;
// Resource types we never need for parsing text results — block to cut memory
// and latency.
const BLOCKED_RESOURCES = new Set(['image', 'media', 'font']);

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ executablePath: CHROMIUM_PATH, headless: true, args: LAUNCH_ARGS })
      .then((browser) => {
        // If Chromium dies, drop the memo so the next call relaunches.
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

// Minimal FIFO semaphore bounding concurrent pages.
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_PAGES) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next();
  else active--;
}

/**
 * Run `fn` with a fresh page in its own context (cookies isolated), tearing the
 * context down afterwards. Bounded by the page semaphore.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  await acquire();
  const browser = await getBrowser();
  const context = await browser.newContext({ locale: 'zh-CN', userAgent: USER_AGENT });
  try {
    await context.route('**/*', (route) => {
      if (BLOCKED_RESOURCES.has(route.request().resourceType())) route.abort();
      else route.continue();
    });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
    release();
  }
}

/** Close the shared browser (called on shutdown). */
export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) await p.then((b) => b.close()).catch(() => {});
}

let hooked = false;
/** Register shutdown handlers once so Chromium doesn't linger after the server exits. */
export function initBrowserShutdown(): void {
  if (hooked) return;
  hooked = true;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      void closeBrowser();
    });
  }
}
