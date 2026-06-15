/**
 * Edition-aware ping dispatch shared by the status and banner endpoints.
 */
import { pingJava } from './ping-java';
import { pingBedrock } from './ping-bedrock';
import type { PingOptions, ServerStatus } from './types';

export type RequestEdition = 'java' | 'bedrock' | 'auto';

export async function pingServer(
  host: string,
  edition: RequestEdition,
  opts: PingOptions = {},
): Promise<ServerStatus> {
  if (edition === 'bedrock') return pingBedrock(host, opts);
  if (edition === 'auto') {
    try {
      return await pingJava(host, opts);
    } catch {
      return pingBedrock(host, opts);
    }
  }
  return pingJava(host, opts);
}
