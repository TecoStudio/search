import type { ParsedMotd } from './motd-parser';

export interface PlayerSample {
  name: string;
  id: string;
}

/** Unified server status shape returned by both Java and Bedrock pings. */
export interface ServerStatus {
  host: string;
  port: number;
  ip: string | null;
  online: boolean;
  latency: number; // ms
  version: string;
  protocol: number;
  players: {
    online: number;
    max: number;
    sample: PlayerSample[];
  };
  motd: ParsedMotd;
  favicon: string | null;
}

export type Edition = 'java' | 'bedrock';

export type PingStep = 'dns' | 'connecting' | 'handshake';

export interface PingTimeouts {
  dns?: number; // default 3000
  connect?: number; // default 3000
  read?: number; // default 2000
}

export interface PingOptions {
  /** Explicit port; when omitted, SRV lookup (Java) or the edition default is used. */
  port?: number;
  timeout?: PingTimeouts;
  /** Called as the ping advances through its phases, for SSE step events. */
  onStep?: (step: PingStep) => void;
  /** Abort the ping (e.g. on client disconnect). */
  signal?: AbortSignal;
}

export const DEFAULT_TIMEOUTS: Required<PingTimeouts> = {
  dns: 3000,
  connect: 3000,
  read: 2000,
};

export const DEFAULT_JAVA_PORT = 25565;
export const DEFAULT_BEDROCK_PORT = 19132;
