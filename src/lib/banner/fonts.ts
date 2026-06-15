/**
 * Font loader for Satori. Reads the TTF buffers once and caches them, so we
 * never touch the filesystem per request (see project spec).
 *
 * Fonts live in src/assets/fonts/ and are fetched by scripts/fetch-fonts.mjs
 * (run on `bun install` / `bun run fonts`). Override the directory with FONTS_DIR.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FontDef {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
}

const FONT_FILES: Array<{
  file: string;
  name: string;
  weight: 400 | 700;
}> = [
  { file: 'Inter-Regular.ttf', name: 'Inter', weight: 400 },
  { file: 'Inter-Bold.ttf', name: 'Inter', weight: 700 },
  { file: 'NotoSansSC-Regular.ttf', name: 'Noto Sans SC', weight: 400 },
];

let cache: Promise<FontDef[]> | null = null;

async function load(): Promise<FontDef[]> {
  const dir = process.env.FONTS_DIR || join(process.cwd(), 'src/assets/fonts');
  return Promise.all(
    FONT_FILES.map(async ({ file, name, weight }) => ({
      name,
      weight,
      style: 'normal' as const,
      data: await readFile(join(dir, file)),
    })),
  );
}

/** Returns the cached Satori font set, loading buffers on first call. */
export function getFonts(): Promise<FontDef[]> {
  if (!cache) {
    cache = load().catch((err) => {
      cache = null; // allow retry on a later request
      throw new Error(
        `Failed to load banner fonts (run \`bun run fonts\`): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }
  return cache;
}

/** Font family stack: Latin via Inter, CJK fallback via Noto Sans SC. */
export const FONT_FAMILY = 'Inter, "Noto Sans SC"';
