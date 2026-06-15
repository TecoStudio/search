# Repository Guidelines

## Project Structure & Module Organization

MCSearch is an Astro 6 SSR app using TypeScript, Vue islands, MDX docs, and Tailwind CSS v4. Route files live in `src/pages/`; API endpoints are under `src/pages/api/v1/server/`. Shared logic belongs in `src/lib/`: `mc/` for Minecraft ping and MOTD parsing, `banner/` for Satori/resvg image generation, `http/` for request helpers, and `cache/` for Redis. Vue client components live in `src/components/islands/`, layouts in `src/layouts/`, docs in `src/content/docs/`, global styles in `src/styles/global.css`, static assets in `public/`, and scripts in `scripts/`.

## Build, Test, and Development Commands

Use Bun for dependency management because the repo includes `bun.lock`.

- `bun install`: install dependencies and fetch banner fonts via `postinstall`.
- `bun run dev`: start the Astro development server.
- `bun run build`: build the SSR app into `dist/`.
- `bun run preview`: preview the built app locally.
- `bun run typecheck`: run `tsc --noEmit` with Astro strict settings.
- `bun run fonts`: refresh generated font assets in `src/assets/fonts/` (gitignored).

## Coding Style & Naming Conventions

Write TypeScript as ES modules with exported types where they clarify API contracts. Follow the existing two-space indentation in `.astro`, `.vue`, and config files. Keep server-only protocol code in `src/lib/` and route handlers thin. Use kebab-case for route filenames and docs slugs, PascalCase for Vue components, and lower camelCase for functions and variables. Reuse helpers for parsing, headers, SSE, and Redis behavior.

## Testing Guidelines

There is no dedicated test runner configured yet. Before submitting changes, run `bun run typecheck` and `bun run build`. For API behavior, verify endpoints manually with Java and Bedrock hosts, including offline/error cases. If adding tests later, place focused specs near the feature or under `tests/`, named after the module, such as `motd-parser.test.ts`.

## Commit & Pull Request Guidelines

Git history currently contains only `Initial commit`, so use clear imperative commit subjects such as `Add server status docs` or `Fix Bedrock ping timeout`. Keep commits scoped to one logical change. Pull requests should include a summary, verification commands, linked issues when applicable, and screenshots or recordings for UI changes. Note environment assumptions, especially `REDIS_URL`, `FONTS_DIR`, `PORT`, or `HOST`.

## Security & Configuration Tips

Do not commit generated fonts, `dist/`, local secrets, or Redis credentials. `REDIS_URL` is optional; code should continue to work with cache disabled. Validate public query parameters in endpoint handlers before passing them into network or rendering logic.
