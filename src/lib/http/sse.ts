/**
 * SSE helpers — format events per spec: `event: <type>\ndata: <json>\n\n`
 */

export function formatSseEvent(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  // Guard against multi-line payloads breaking the SSE frame.
  const safe = payload.replace(/\r?\n/g, ' ');
  return `event: ${event}\ndata: ${safe}\n\n`;
}

export interface SseSender {
  /** Enqueue an SSE event; silently no-ops if the stream is already closed. */
  send(event: string, data: unknown): void;
  /** Close the stream. */
  close(): void;
}

/**
 * Build a streaming SSE Response. The `producer` runs once the stream starts and
 * receives a sender; closing happens automatically when it resolves/rejects.
 */
export function createSseResponse(
  producer: (sender: SseSender) => Promise<void> | void,
  headers: Headers,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const sender: SseSender = {
        send(event, data) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(formatSseEvent(event, data)));
          } catch {
            closed = true;
          }
        },
        close() {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
      };
      try {
        await producer(sender);
      } finally {
        sender.close();
      }
    },
  });
  return new Response(stream, { headers });
}
