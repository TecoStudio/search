/**
 * Bedrock Edition ping — RakNet "Unconnected Ping / Pong" over UDP.
 *
 * Flow: resolve → bind UDP socket → send 0x01 ping → receive 0x1c pong →
 * parse the semicolon-delimited server-id string.
 */
import dgram from 'node:dgram';
import net from 'node:net';
import dns from 'node:dns/promises';

import { parseMotd } from './motd-parser';
import {
  DEFAULT_BEDROCK_PORT,
  DEFAULT_TIMEOUTS,
  type PingOptions,
  type ServerStatus,
} from './types';

// RakNet "magic" sequence — identifies offline messages.
const MAGIC = Buffer.from([
  0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe, 0xfd, 0xfd, 0xfd, 0xfd, 0x12,
  0x34, 0x56, 0x78,
]);

interface Resolved {
  address: string;
  family: 4 | 6;
}

async function resolve(host: string): Promise<Resolved> {
  const lit = net.isIP(host);
  if (lit) return { address: host, family: lit === 6 ? 6 : 4 };
  const { address, family } = await dns.lookup(host);
  return { address, family: family === 6 ? 6 : 4 };
}

function buildPing(): Buffer {
  const time = Buffer.alloc(8); // echoed back, value irrelevant
  const clientGuid = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) clientGuid[i] = Math.floor(Math.random() * 256);
  return Buffer.concat([Buffer.from([0x01]), time, MAGIC, clientGuid]);
}

/**
 * Parse the Bedrock server-id string:
 *   edition;motd1;protocol;version;online;max;guid;motd2;gamemode;gmId;portV4;portV6
 */
function parseServerId(id: string) {
  const f = id.split(';');
  const motdLines = [f[1] ?? '', f[7] ?? ''].filter(Boolean);
  return {
    motd: motdLines.join('\n'),
    protocol: Number(f[2] ?? 0),
    version: f[3] || 'Unknown',
    online: Number(f[4] ?? 0),
    max: Number(f[5] ?? 0),
  };
}

export async function pingBedrock(
  host: string,
  opts: PingOptions = {},
): Promise<ServerStatus> {
  const timeout = { ...DEFAULT_TIMEOUTS, ...opts.timeout };
  const port = opts.port ?? DEFAULT_BEDROCK_PORT;

  opts.onStep?.('dns');
  const { address, family } = await resolve(host);

  opts.onStep?.('connecting');
  const socket = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');

  const cleanup = () => {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  };

  if (opts.signal) {
    if (opts.signal.aborted) cleanup();
    opts.signal.addEventListener('abort', cleanup, { once: true });
  }

  try {
    return await new Promise<ServerStatus>((resolveResult, reject) => {
      let t0 = 0;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('read timeout'));
      }, timeout.connect + timeout.read);

      socket.once('error', (err) => {
        clearTimeout(timer);
        cleanup();
        reject(err);
      });

      socket.once('message', (msg) => {
        clearTimeout(timer);
        const latency = Date.now() - t0;
        cleanup();
        try {
          if (msg[0] !== 0x1c) throw new Error('unexpected packet');
          // 1 (id) + 8 (time) + 8 (guid) + 16 (magic) + 2 (strlen) = 35
          const strLen = msg.readUInt16BE(33);
          const idStr = msg.subarray(35, 35 + strLen).toString('utf8');
          const parsed = parseServerId(idStr);
          resolveResult({
            host,
            port,
            ip: address,
            online: true,
            latency,
            version: parsed.version,
            protocol: parsed.protocol,
            players: { online: parsed.online, max: parsed.max, sample: [] },
            motd: parseMotd(parsed.motd),
            favicon: null,
          });
        } catch (err) {
          reject(err as Error);
        }
      });

      opts.onStep?.('handshake');
      t0 = Date.now();
      socket.send(buildPing(), port, address, (err) => {
        if (err) {
          clearTimeout(timer);
          cleanup();
          reject(err);
        }
      });
    });
  } finally {
    cleanup();
  }
}
