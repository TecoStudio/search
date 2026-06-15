import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().default(0),
    /** Catalog endpoint id; when set, an embedded mini-playground is shown. */
    endpoint: z.string().optional(),
  }),
});

export const collections = { docs };
