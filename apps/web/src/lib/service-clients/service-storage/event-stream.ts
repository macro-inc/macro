import { SERVER_HOSTS } from '@core/constant/servers';
import { getMacroApiToken } from '@service-auth/fetch';

/** One filter of the event stream: event names, optionally narrowed to entity ids. */
export type EventStreamFilter = { events: string[]; ids?: string[] };

/** One server-sent event: its name and parsed JSON data. */
export type StreamedEvent = { name: string; data: unknown };

export type EventStreamOptions = {
  filters: EventStreamFilter[];
  signal: AbortSignal;
  /** Trace context to send, so the server's stream joins the caller's trace. */
  traceHeaders?: Record<string, string>;
  /** Called once the server accepted the stream, before any event. */
  onOpen?: () => void;
  onEvent: (event: StreamedEvent) => void;
};

const dssHost = SERVER_HOSTS['document-storage-service'];

/**
 * The server refused the stream's request (its filters, or access), so
 * opening it again would be refused the same way.
 */
export class EventStreamRefused extends Error {
  constructor(public readonly status: number) {
    super(`The event stream refused the request (HTTP ${status}).`);
    this.name = 'EventStreamRefused';
  }
}

/** Statuses a retry can't fix: everything 4xx but expired auth and throttling. */
function isRefusal(status: number): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

/**
 * Stream the viewer's own entity events (`GET /webhook/events/stream`),
 * filtered and access-checked on the server. Resolves when the server ends
 * the stream and rejects when it refuses or the connection fails; callers
 * reconnect, except after an {@link EventStreamRefused}. Delivery is
 * best-effort with no replay.
 *
 * A raw `fetch` because `safeFetch` reads whole bodies; the bearer is the
 * same Macro API token the SDK uses for this endpoint.
 */
export async function streamEvents(options: EventStreamOptions): Promise<void> {
  const token = await getMacroApiToken();
  const query = new URLSearchParams({
    scope: 'user',
    filters: JSON.stringify(options.filters),
  });
  const response = await fetch(`${dssHost}/webhook/events/stream?${query}`, {
    headers: {
      ...options.traceHeaders,
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    signal: options.signal,
  });
  if (isRefusal(response.status)) throw new EventStreamRefused(response.status);
  if (!response.ok || !response.body) {
    throw new Error(`The event stream answered ${response.status}.`);
  }
  options.onOpen?.();
  for await (const event of parseServerSentEvents(response.body)) {
    options.onEvent(event);
  }
}

const EVENT_SEPARATOR = /\r?\n\r?\n/;

/**
 * Server-Sent Events from a byte stream: `event:` and `data:` fields, events
 * separated by a blank line. Comments (keep-alives) and events whose data is
 * not JSON are skipped.
 */
export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamedEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      for (
        let match = EVENT_SEPARATOR.exec(buffer);
        match;
        match = EVENT_SEPARATOR.exec(buffer)
      ) {
        const event = readEvent(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (event) yield event;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function readEvent(block: string): StreamedEvent | undefined {
  let name = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') name = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return undefined;
  try {
    return { name, data: JSON.parse(data.join('\n')) };
  } catch {
    return undefined;
  }
}
