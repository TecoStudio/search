import { test, expect } from 'bun:test';

process.env.CHROMIUM_PATH = '/definitely-not-a-real-chromium';

const { withPage } = await import('../src/lib/mod/browser.ts');

const settlesQuickly = async (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(() => 'settled', () => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('timed out'), 250)),
  ]);

test('releases the page slot when Chromium launch fails', async () => {
  const first = await Promise.all([
    settlesQuickly(withPage(async () => undefined)),
    settlesQuickly(withPage(async () => undefined)),
    settlesQuickly(withPage(async () => undefined)),
  ]);

  expect(first).toEqual(['settled', 'settled', 'settled']);
  expect(await settlesQuickly(withPage(async () => undefined))).toBe('settled');
});
