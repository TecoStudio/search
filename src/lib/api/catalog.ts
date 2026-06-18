/**
 * Canonical catalog of public API endpoints.
 *
 * Single source of truth shared by the docs pages and the Playground so code
 * examples, parameter forms and the live runner never drift from each other.
 */

export type ResponseType = 'sse' | 'json' | 'image';

export interface ApiParam {
  name: string;
  required: boolean;
  description: string;
  example?: string;
  /** Render as a <select> with these options. */
  enum?: string[];
}

export interface ApiEndpoint {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  title: string;
  summary: string;
  responseType: ResponseType;
  params: ApiParam[];
  /** SSE event types this endpoint emits (for response labelling). */
  events?: string[];
}

const SERVER_PARAMS: ApiParam[] = [
  {
    name: 'host',
    required: true,
    description: '服务器地址（域名或 IP）',
    example: 'mc.hypixel.net',
  },
  {
    name: 'port',
    required: false,
    description: '端口；缺省时走 SRV 解析或默认端口',
  },
  {
    name: 'edition',
    required: false,
    description: '服务器类型',
    enum: ['java', 'bedrock', 'auto'],
    example: 'java',
  },
];

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    id: 'server-status',
    method: 'GET',
    path: '/api/v1/server/status',
    title: '服务器状态查询',
    summary:
      '以 SSE 流式返回服务器状态，按序推送 dns / connecting / handshake 步骤与最终结果。',
    responseType: 'sse',
    params: SERVER_PARAMS,
    events: ['step', 'result', 'error'],
  },
  {
    id: 'server-banner',
    method: 'GET',
    path: '/api/v1/server/banner',
    title: '状态 Banner',
    summary: '实时生成 800×200 的服务器状态横幅图（PNG），离线服务器也会出图。',
    responseType: 'image',
    params: SERVER_PARAMS,
  },
  {
    id: 'server-icon',
    method: 'GET',
    path: '/api/v1/server/icon',
    title: '服务器图标',
    summary: '返回服务器 favicon（64×64 PNG），无图标时返回占位图。',
    responseType: 'image',
    params: SERVER_PARAMS,
  },
  {
    id: 'mod-search',
    method: 'GET',
    path: '/api/v1/mod/search',
    title: 'Mod 搜索',
    summary:
      '聚合 Modrinth / BBSMC / CurseForge 原生搜索 API 与固定大站（MC百科 / B站 / MC Wiki）、BBSPK 动态论坛白名单（Bing site: 搜索），按来源归类。缓存 3600s。',
    responseType: 'json',
    params: [
      {
        name: 'q',
        required: true,
        description: '搜索关键词',
        example: '工业时代',
      },
      {
        name: 'source',
        required: false,
        description:
          '来源过滤：all | modrinth | bbsmc | curseforge | mcmod | bilibili | <论坛 id>',
        example: 'all',
      },
      {
        name: 'page',
        required: false,
        description: '页码（从 1 开始）',
        example: '1',
      },
    ],
  },
  {
    id: 'mod-sources',
    method: 'GET',
    path: '/api/v1/mod/sources',
    title: 'Mod 搜索来源列表',
    summary:
      '列出全部可用搜索来源（固定大站 + BBSPK 动态论坛白名单），供发现 mod 搜索的 source id。缓存 300s。',
    responseType: 'json',
    params: [],
  },
  {
    id: 'wiki-search',
    method: 'GET',
    path: '/api/v1/wiki/search',
    title: 'Wiki 全文搜索',
    summary:
      '代理 zh.minecraft.wiki 全文搜索，返回最多 5 条结果，snippet 高亮以 <mark> 保留。缓存 600s。',
    responseType: 'json',
    params: [
      {
        name: 'q',
        required: true,
        description: '搜索关键词',
        example: '红石',
      },
    ],
  },
  {
    id: 'wiki-page',
    method: 'GET',
    path: '/api/v1/wiki/page',
    title: 'Wiki 词条摘要',
    summary:
      '代理 zh.minecraft.wiki 词条摘要，返回标题、纯文本摘要（≤300 字）、缩略图与跳转链接。缓存 1800s。',
    responseType: 'json',
    params: [
      {
        name: 'title',
        required: true,
        description: '词条标题（自动跟随重定向）',
        example: '红石',
      },
    ],
  },
  {
    id: 'wiki-suggest',
    method: 'GET',
    path: '/api/v1/wiki/suggest',
    title: 'Wiki 搜索建议',
    summary:
      '代理 zh.minecraft.wiki OpenSearch 自动补全，返回最多 5 条标题建议。缓存 300s。',
    responseType: 'json',
    params: [
      {
        name: 'q',
        required: true,
        description: '搜索关键词',
        example: '红石',
      },
    ],
  },
];

export function getEndpoint(id: string): ApiEndpoint | undefined {
  return API_ENDPOINTS.find((e) => e.id === id);
}

/** Default param values from each param's `example`. */
export function defaultValues(ep: ApiEndpoint): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of ep.params) values[p.name] = p.example ?? '';
  return values;
}
