/**
 * Java Edition Server List Ping (1.7+ protocol).
 *
 * Flow: SRV resolve → TCP connect → Handshake + Status Request → Status Response.
 * Latency is measured as the round-trip of the status request.
 */
import net from 'node:net';
import dns from 'node:dns/promises';

import { parseMotd } from './motd-parser';
import {
  DEFAULT_JAVA_PORT,
  DEFAULT_TIMEOUTS,
  type PingOptions,
  type ServerStatus,
} from './types';

/* ------------------------------- VarInt I/O ------------------------------- */

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value | 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if ((v & ~0x7f) === 0) {
      bytes.push(v & 0xff);
      break;
    }
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7; // unsigned shift so negatives terminate
  }
  return Buffer.from(bytes);
}

function readVarInt(
  buf: Buffer,
  offset: number,
): { value: number; size: number } | null {
  let value = 0;
  let size = 0;
  let byte: number;
  do {
    if (offset + size >= buf.length) return null; // need more bytes
    if (size >= 5) throw new Error('VarInt too big');
    byte = buf[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size++;
  } while (byte & 0x80);
  return { value: value | 0, size };
}

function writeString(str: string): Buffer {
  const data = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(data.length), data]);
}

/* ------------------------------ target resolve ---------------------------- */

interface Target {
  host: string; // hostname/IP to dial
  port: number;
  ip: string | null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

async function resolveIp(host: string): Promise<string | null> {
  if (net.isIP(host)) return host;
  try {
    const { address } = await dns.lookup(host);
    return address;
  } catch {
    return null;
  }
}

async function resolveTarget(
  host: string,
  explicitPort: number | undefined,
  dnsTimeout: number,
): Promise<Target> {
  if (explicitPort != null) {
    return { host, port: explicitPort, ip: await resolveIp(host) };
  }
  // Try SRV record first: _minecraft._tcp.<host>
  try {
    const records = await withTimeout(
      dns.resolveSrv(`_minecraft._tcp.${host}`),
      dnsTimeout,
    );
    if (records.length) {
      const best = records.sort((a, b) => a.priority - b.priority)[0];
      return {
        host: best.name,
        port: best.port,
        ip: await resolveIp(best.name),
      };
    }
  } catch {
    // no SRV record / lookup failed — fall through to default port
  }
  return { host, port: DEFAULT_JAVA_PORT, ip: await resolveIp(host) };
}

/* -------------------------------- socket I/O ------------------------------ */

function connect(host: string, port: number, ms: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('connect timeout'));
    }, ms);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Read exactly one length-prefixed packet, returning its inner bytes (id + data). */
function readPacket(socket: net.Socket, ms: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('read timeout'));
    }, ms);

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }
    function onData(chunk: Buffer) {
      acc = Buffer.concat([acc, chunk]);
      const header = readVarInt(acc, 0);
      if (!header) return; // length VarInt incomplete
      if (acc.length >= header.size + header.value) {
        cleanup();
        resolve(acc.subarray(header.size, header.size + header.value));
      }
    }
    function onError(err: Error) {
      cleanup();
      reject(err);
    }
    function onClose() {
      cleanup();
      reject(new Error('connection closed'));
    }

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

/* ---------------------------------- ping ---------------------------------- */

function stripLegacy(s: string): string {
  return parseMotd(s).plain;
}

export async function pingJava(
  host: string,
  opts: PingOptions = {},
): Promise<ServerStatus> {
  const timeout = { ...DEFAULT_TIMEOUTS, ...opts.timeout };

  opts.onStep?.('dns');
  const target = await resolveTarget(host, opts.port, timeout.dns);

  opts.onStep?.('connecting');
  const socket = await connect(target.host, target.port, timeout.connect);

  if (opts.signal) {
    if (opts.signal.aborted) socket.destroy();
    opts.signal.addEventListener('abort', () => socket.destroy(), {
      once: true,
    });
  }

  try {
    opts.onStep?.('handshake');

    const portBuf = Buffer.alloc(2);
    portBuf.writeUInt16BE(target.port, 0);
    const handshakeData = Buffer.concat([
      writeVarInt(0x00), // packet id: handshake
      writeVarInt(-1), // protocol version: unknown (servers reply regardless)
      writeString(host),
      portBuf,
      writeVarInt(1), // next state: status
    ]);
    const handshake = Buffer.concat([
      writeVarInt(handshakeData.length),
      handshakeData,
    ]);
    const statusRequest = Buffer.concat([writeVarInt(1), writeVarInt(0x00)]);

    const t0 = Date.now();
    socket.write(Buffer.concat([handshake, statusRequest]));

    const packet = await readPacket(socket, timeout.read);
    const latency = Date.now() - t0;

    // packet = <VarInt packetId=0x00><VarInt strLen><JSON utf8>
    const id = readVarInt(packet, 0);
    if (!id) throw new Error('malformed status packet');
    const strLen = readVarInt(packet, id.size);
    if (!strLen) throw new Error('malformed status string length');
    const jsonStart = id.size + strLen.size;
    const json = packet
      .subarray(jsonStart, jsonStart + strLen.value)
      .toString('utf8');
    const data = JSON.parse(json);

    const sample = Array.isArray(data?.players?.sample)
      ? data.players.sample
          .filter((p: unknown) => p && typeof p === 'object')
          .map((p: { name?: string; id?: string }) => ({
            name: stripLegacy(String(p.name ?? '')),
            id: String(p.id ?? ''),
          }))
      : [];

    return {
      host,
      port: target.port,
      ip: target.ip,
      online: true,
      latency,
      version: String(data?.version?.name ?? 'Unknown'),
      protocol: Number(data?.version?.protocol ?? 0),
      players: {
        online: Number(data?.players?.online ?? 0),
        max: Number(data?.players?.max ?? 0),
        sample,
      },
      motd: parseMotd(data?.description ?? ''),
      favicon: typeof data?.favicon === 'string' ? data.favicon : null,
    };
  } finally {
    socket.destroy();
  }
}
