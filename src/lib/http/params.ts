/**
 * Parse the common server-query params (host / port / edition) shared by the
 * /api/v1/server/* endpoints.
 */
import type { RequestEdition } from '../mc/ping';

export interface ServerParams {
  host: string;
  port?: number;
  edition: RequestEdition;
}

export type ParseResult =
  | { ok: true; params: ServerParams }
  | { ok: false; error: string };

/**
 * Read a required, trimmed string query param. Returns an error result when the
 * param is missing/empty or exceeds `maxLen` (defends against abuse).
 */
export function requireStringParam(
  url: URL,
  name: string,
  maxLen = 300,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = url.searchParams.get(name)?.trim();
  if (!raw) return { ok: false, error: `Missing required query param: ${name}` };
  if (raw.length > maxLen) {
    return { ok: false, error: `Query param ${name} too long (max ${maxLen})` };
  }
  return { ok: true, value: raw };
}

export function parseServerParams(url: URL): ParseResult {
  const host = url.searchParams.get('host')?.trim();
  if (!host) {
    return { ok: false, error: 'Missing required query param: host' };
  }

  let port: number | undefined;
  const portParam = url.searchParams.get('port');
  if (portParam != null && portParam !== '') {
    port = Number(portParam);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: `Invalid port: ${portParam}` };
    }
  }

  const e = (url.searchParams.get('edition') ?? 'java').toLowerCase();
  const edition: RequestEdition =
    e === 'bedrock' || e === 'auto' ? e : 'java';

  return { ok: true, params: { host, port, edition } };
}
