/**
 * Browser-side API runner. Uses fetch (not EventSource) so we can surface
 * response headers AND stream SSE events with one code path.
 */
import type { ResponseType } from '../api/catalog';

export interface RunEvent {
  event: string;
  data: string;
}

export interface RunResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  type: 'sse' | 'json' | 'image' | 'text';
  body?: string; // json/text
  imageUrl?: string; // image (object URL)
  durationMs: number;
}

export interface RunHandlers {
  onEvent?: (e: RunEvent) => void;
  signal?: AbortSignal;
}

function parseFrame(raw: string): RunEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return null;
  return { event, data: data.join('\n') };
}

export async function runRequest(
  url: string,
  responseType: ResponseType,
  handlers: RunHandlers = {},
): Promise<RunResult> {
  const t0 = performance.now();
  const res = await fetch(url, { signal: handlers.signal });

  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const base = { status: res.status, ok: res.ok, headers };

  if (responseType === 'sse' && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = parseFrame(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (frame) handlers.onEvent?.(frame);
      }
    }
    return { ...base, type: 'sse', durationMs: performance.now() - t0 };
  }

  if (responseType === 'image') {
    const blob = await res.blob();
    return {
      ...base,
      type: 'image',
      imageUrl: URL.createObjectURL(blob),
      durationMs: performance.now() - t0,
    };
  }

  const body = await res.text();
  return {
    ...base,
    type: responseType === 'json' ? 'json' : 'text',
    body,
    durationMs: performance.now() - t0,
  };
}
