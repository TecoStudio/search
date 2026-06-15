// @ts-check
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';
import vue from '@astrojs/vue';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [vue(), mdx()],
  markdown: {
    shikiConfig: { theme: 'github-dark', wrap: true },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
