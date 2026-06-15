# MCSearch — 搜遍 MC 世界

> 为简体中文 Minecraft 社区打造的综合搜索平台：服务器状态查询、Mod 聚合搜索、Banner 生成，统一对外 API。

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
| `REDIS_URL`          | Redis 连接串；未设置时缓存全部降级为 no-op                           | _（无，缓存关闭）_   |
| `BING_SEARCH_KEY`    | Bing Web Search API Key；缺省时 Mod 搜索的 site: 来源（论坛/大站）返回 503 | _（无）_            |
| `BING_SEARCH_ENDPOINT` | Bing 搜索端点覆盖                                                  | `…/v7.0/search`     |
| `CURSEFORGE_API_KEY` | CurseForge API Key；缺省时 CurseForge 来源在 `all` 模式被跳过、单独查询返回 503 | _（无，CF 关闭）_   |
| `FONTS_DIR`          | Banner 字体目录覆盖                                                  | `src/assets/fonts/` |

## 已实现的 API

所有 `/api/v1/*` 接口统一返回响应头：`X-Powered-By: MCSearch`、`X-Cache: HIT|MISS`、
`X-Response-Time: <ms>`、`Access-Control-Allow-Origin: *`。

公共查询参数：`host`（必填）、`port`（可选，缺省走 SRV / 默认端口）、
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

## 页面

- `/` 首页（内嵌服务器查询）
- `/server` 服务器状态查询

## 目录结构

```
src/
├── pages/
│   ├── index.astro                 # 首页
│   ├── server/index.astro          # 服务器查询页
│   └── api/v1/server/
│       ├── status.ts               # SSE 状态查询
│       ├── banner.ts               # Banner PNG
│       └── icon.ts                 # 图标 PNG
├── components/islands/
│   └── ServerQuery.vue             # 服务器查询 Island（EventSource）
├── lib/
│   ├── mc/                         # ping-java / ping-bedrock / motd-parser / ping / types
│   ├── banner/                     # generate（Satori）/ fonts
│   ├── cache/redis.ts              # 优雅降级的 Redis 封装
│   └── http/                       # headers / sse / params
└── styles/global.css               # Tailwind v4 主题
```

## 开发进度

- [x] 服务器状态查询（Java + Bedrock，SSE）
- [x] MOTD 解析（§ 格式码 + JSON Chat Component）
- [x] Banner / 图标生成（Satori + resvg）
- [x] Mod 聚合搜索（Modrinth / BBSMC / CurseForge 原生 API + MC百科 / B站 / BBSPK 论坛 Bing site:）
- [ ] API 文档（MDX）与 Playground
- [ ] 部署配置（k8s：PostgreSQL / Redis / Meilisearch）
