# syntax=docker/dockerfile:1

# ---- build stage (bun on Debian/glibc) ----
FROM oven/bun:1 AS build
WORKDIR /app

# Install deps first for layer caching. The postinstall hook
# (scripts/fetch-fonts.mjs) downloads the Satori banner fonts, so scripts/ must
# already be present when `bun install` runs.
COPY package.json bun.lock ./
COPY scripts ./scripts
RUN bun install --frozen-lockfile

# Build the Astro SSR app — @astrojs/node standalone -> dist/server/entry.mjs.
COPY . .
RUN bun run build

# ---- runtime stage (Node on Debian/glibc — matches the build's native
#       @resvg/resvg-js binary, which is the glibc "gnu" variant) ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    CHROMIUM_PATH=/usr/bin/chromium

# Chromium for the Bing web-search scraper (src/lib/mod/browser.ts). The Debian
# package pulls its own shared-lib deps; fonts-noto-cjk renders the zh-CN SERP.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium fonts-liberation fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Server bundle + externalized deps + the font buffers read at runtime from
# $CWD/src/assets/fonts (see src/lib/banner/fonts.ts).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/assets/fonts ./src/assets/fonts

USER node
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
