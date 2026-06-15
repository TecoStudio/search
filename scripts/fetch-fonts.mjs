#!/usr/bin/env node
/**
 * Download the fonts needed for Satori banner rendering into src/assets/fonts/.
 *
 * Idempotent (skips files that already exist) and non-fatal (warns instead of
 * failing install if the network is unavailable — the banner endpoint will
 * report the missing font at request time).
 *
 * Fonts:
 *   Inter 400/700           — Latin text + numerals
 *   Noto Sans SC 400        — 简体中文 (思源黑体等价)
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src/assets/fonts');

const FONTS = [
  {
    file: 'Inter-Regular.ttf',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf',
  },
  {
    file: 'Inter-Bold.ttf',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf',
  },
  {
    file: 'NotoSansSC-Regular.ttf',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@latest/chinese-simplified-400-normal.ttf',
  },
];

async function exists(path) {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let failures = 0;

  for (const { file, url } of FONTS) {
    const dest = join(outDir, file);
    if (await exists(dest)) {
      console.log(`✓ ${file} (cached)`);
      continue;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      console.log(`↓ ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failures++;
      console.warn(`! failed to fetch ${file}: ${err.message}`);
    }
  }

  if (failures) {
    console.warn(
      `\n${failures} font(s) missing — banner generation will be unavailable until fetched.`,
    );
  }
}

main().catch((err) => {
  console.warn(`font fetch skipped: ${err.message}`);
});
