/**
 * Redis cache wrapper with graceful degradation.
 *
 * If REDIS_URL is unset or Redis is unreachable, every operation becomes a
 * silent no-op (get → null, set → ignored) so the app runs fine without infra.
 * Wire up a real Redis later (k8s) by setting REDIS_URL.
 *
 * Key conventions (per spec):
 *   mcsearch:server:status:<host>:<port>   TTL 30s
 *   mcsearch:server:banner:<host>:<port>   TTL 60s
 *   mcsearch:mod:search:<q>:<source>       TTL 300s
 */
import Redis from 'ioredis';

let client: Redis | null = null;
let disabled = false;

function getClient(): Redis | null {
  if (disabled) return null;
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    disabled = true;
    return null;
  }

  try {
    client = new Redis(url, {
      lazyConnect: false,
      enableOfflineQueue: false, // fail fast when disconnected
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // don't hammer a dead server
    });
    // Swallow connection errors — ops below degrade to no-ops.
    client.on('error', () => {});
    return client;
  } catch {
    disabled = true;
    return null;
  }
}

export function isCacheEnabled(): boolean {
  return !!process.env.REDIS_URL && !disabled;
}

export async function cacheGet(key: string): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    return await c.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(key, value, 'EX', ttlSeconds);
  } catch {
    /* ignore */
  }
}

export async function cacheGetBuffer(key: string): Promise<Buffer | null> {
  const c = getClient();
  if (!c) return null;
  try {
    return await c.getBuffer(key);
  } catch {
    return null;
  }
}

export async function cacheSetBuffer(
  key: string,
  value: Buffer,
  ttlSeconds: number,
): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(key, value, 'EX', ttlSeconds);
  } catch {
    /* ignore */
  }
}
