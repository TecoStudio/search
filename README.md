# MCSearch — 搜遍 MC 世界

> 为简体中文 Minecraft 社区打造的综合搜索平台：服务器状态查询、Mod 聚合搜索、Banner 生成，统一对外 API。

线上地址：<https://search.tecostudio.cn>（API 文档 [`/docs`](https://search.tecostudio.cn/docs) · Playground [`/playground`](https://search.tecostudio.cn/playground)）。

## 技术栈

- **框架**：Astro 6（SSR / Node adapter）+ Vue 3 Islands
- **样式**：Tailwind CSS v4
- **图片生成**：Satori + @resvg/resvg-js
- **缓存**：Redis（可选，未配置时自动降级为无缓存）
- **协议**：原生 Java/Bedrock Server List Ping（`node:net` / `node:dgram`）

## 快速开始

```bash
bun install          # 安装依赖（postinstall 会自动拉取 Banner 所需字体）
bun run dev          # 开发服务器
bun run build        # 构建
node ./dist/server/entry.mjs   # 运行（PORT/HOST 可配置）
```

辅助脚本：

```bash
bun run fonts        # 重新拉取字体（src/assets/fonts/，已 gitignore）
bun run typecheck    # tsc --noEmit
```

### 环境变量

| 变量                 | 说明                                                                 | 默认                |
| -------------------- | ------------------------------------------------------------------- | ------------------- |
| `REDIS_URL`          | Redis 连接串；未设置时缓存与限流全部降级为 no-op                     | _（无，缓存关闭）_   |
| `CHROMIUM_PATH`      | Mod 搜索抓取 Bing 所用的 Chromium 可执行文件路径                     | `/usr/bin/chromium` |
| `CURSEFORGE_API_KEY` | CurseForge API Key；缺省时 CurseForge 来源在 `all` 模式被跳过、单独查询返回 503 | _（无，CF 关闭）_   |
| `RATE_LIMIT_RPM`     | 每个客户端 IP 每分钟请求上限（仅在配置了 Redis 时生效）              | `60`                |
| `INTERNAL_TOKEN`     | 设置后 `/api/internal/*` 需带 `Authorization: Bearer <token>`；未设置则开放 | _（无，开放）_     |
| `FONTS_DIR`          | Banner 字体目录覆盖                                                  | `src/assets/fonts/` |

## 已实现的 API

所有 `/api/v1/*` 接口统一返回响应头：`X-Powered-By: MCSearch`、`X-Cache: HIT|MISS`、
`X-Response-Time: <ms>`、`Access-Control-Allow-Origin: *`，并支持 `OPTIONS` 预检。

除 `/api/v1/health` 外的接口按客户端 IP 限流（默认 60 rpm，`RATE_LIMIT_RPM` 可配；未配置
Redis 时不限流），响应附带 `X-RateLimit-Limit|Remaining|Reset`，超限返回 `429` + `Retry-After`。

服务器类接口的公共查询参数：`host`（必填）、`port`（可选，缺省走 SRV / 默认端口）、
`edition`（`java` | `bedrock` | `auto`，默认 `java`）。

### `GET /api/v1/server/status` — 服务器状态（SSE）

`text/event-stream`，按序推送事件：

```
event: step\ndata: dns
event: step\ndata: connecting
event: step\ndata: handshake
event: result\ndata: { ...完整状态 JSON... }
# 失败时：event: error\ndata: { message, ... }
```

结果字段：`host, port, ip, online, latency, version, protocol,
players{online,max,sample[]}, motd{raw,html,plain}, favicon`。

- Java：SRV 解析（`_minecraft._tcp.<host>`）→ 握手 → 状态请求
- Bedrock：RakNet Unconnected Ping
- 超时：DNS 3s / TCP 3s / 读取 2s

### `GET /api/v1/server/banner` — 状态 Banner（PNG）

`image/png`，800×200。实时 ping + Satori 渲染，Redis 缓存 60s。离线服务器也会出图。
内容：favicon、MOTD（含格式色）、在线人数、版本、延迟。

### `GET /api/v1/server/icon` — 服务器图标（PNG）

`image/png`，64×64。返回服务器 favicon，缺省时返回占位图。

### `GET /api/v1/mod/search` — Mod 聚合搜索（JSON）

聚合 Modrinth / BBSMC / CurseForge 原生 API 与固定大站（MC百科 / B站 / MC Wiki）、BBSPK
动态论坛白名单（headless Chromium 抓取 Bing `site:` 搜索），按来源归类。缓存 3600s。

参数：`q`（必填）、`source`（`all` | `modrinth` | `bbsmc` | `curseforge` | `mcmod` |
`bilibili` | `<论坛 id>`，默认 `all`）、`page`（从 1 开始）。附加响应头 `X-Sources-Count`。

### `GET /api/v1/mod/sources` — Mod 搜索来源列表（JSON）

列出全部可用来源（固定大站 + BBSPK 动态论坛白名单），供发现 `source` id。缓存 300s。
返回 `{ count, sources: [{ id, name, domain, provider, fixed }] }`。

### `GET /api/v1/wiki/search` — Wiki 全文搜索（JSON）

代理 zh.minecraft.wiki 全文搜索，最多 5 条结果，snippet 高亮以 `<mark>` 保留。缓存 600s。
参数：`q`（必填）。

### `GET /api/v1/wiki/page` — Wiki 词条摘要（JSON）

代理 zh.minecraft.wiki 词条摘要，返回 `{ title, extract, thumbnail, url }`（≤300 字，
自动跟随重定向，负结果同样缓存）。缓存 1800s。参数：`title`（必填）。

### `GET /api/v1/wiki/suggest` — Wiki 搜索建议（JSON）

代理 zh.minecraft.wiki OpenSearch 自动补全，返回最多 5 条 `{ title, url }`。缓存 300s。
参数：`q`（必填）。

### `GET /api/v1/health` — 健康检查（JSON）

返回 `{ status: "ok" }`，无上游调用、不限流，供 k8s 探针使用。

### `GET /api/internal/refresh-sources` — 强制刷新来源白名单（JSON）

重新拉取并解析 BBSPK 论坛列表、覆盖缓存。设置 `INTERNAL_TOKEN` 后需带
`Authorization: Bearer <token>`。返回 `{ ok, forums, fixed, total }`。

## 页面

- `/` 首页（内嵌服务器查询）
- `/server` 服务器状态查询
- `/search` Mod / Wiki 聚合搜索
- `/tools` 工具页
- `/docs` API 文档
- `/playground` API Playground（在线调用 + curl/JS/Python 代码生成）

## 目录结构

```
src/
├── middleware.ts                   # API 网关：CORS 预检 + 限流
├── content/docs/                   # API 文档（MDX，content collection）
├── pages/
│   ├── index.astro                 # 首页
│   ├── server/index.astro          # 服务器查询页
│   ├── search/index.astro          # Mod / Wiki 搜索页
│   ├── docs/                       # 文档页（[...slug] + index）
│   ├── playground/index.astro      # API Playground
│   └── api/
│       ├── v1/server/              # status（SSE）/ banner / icon（PNG）
│       ├── v1/mod/                 # search / sources
│       ├── v1/wiki/                # search / page / suggest
│       ├── v1/health.ts            # 健康检查
│       └── internal/refresh-sources.ts  # 刷新来源白名单
├── components/islands/             # ServerQuery / SearchApp / ApiPlayground / ApiRunner …
├── lib/
│   ├── mc/                         # ping-java / ping-bedrock / motd-parser / ping / types
│   ├── mod/                        # search / sources / modrinth / curseforge / browser
│   ├── wiki/client.ts              # MediaWiki 代理
│   ├── banner/                     # generate（Satori）/ fonts
│   ├── api/catalog.ts              # 接口目录（docs + playground 共享）
│   ├── cache/redis.ts              # 优雅降级的 Redis 封装
│   └── http/                       # headers / sse / params / cached-json / rate-limit
└── styles/global.css               # Tailwind v4 主题
```

## 开发进度

- [x] 服务器状态查询（Java + Bedrock，SSE）
- [x] MOTD 解析（§ 格式码 + JSON Chat Component）
- [x] Banner / 图标生成（Satori + resvg）
- [x] Mod 聚合搜索（Modrinth / BBSMC / CurseForge 原生 API + MC百科 / B站 / BBSPK 论坛 Bing site:）
- [x] Wiki 代理（全文搜索 / 词条摘要 / 搜索建议）
- [x] API 文档（MDX）与 Playground
- [x] 限流 + CORS 预检（中间件，Redis 固定窗口）
- [ ] 部署配置（k8s：PostgreSQL / Redis / Meilisearch）
