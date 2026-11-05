// Macro's live event stream: `GET {storage}/webhook/events/stream` held open,
// reconnecting with doubling backoff (crates/agent_brain events.rs). The
// server never replays, so after every reconnect the stream yields
// `reconnected` with when it dropped; the brain catches up from there.
// The SDK's `macro.events.listen` retries internally and hides the drop, so
// the brain reads the stream itself.
import { AsyncQueue } from './channel.ts';
import type { ListedMessage, Mention, Message } from './macro.ts';
import { startSpan, withSpan } from './telemetry.ts';

export const MESSAGE_POSTED = 'message.posted';
export const AGENT_SESSION_OPENED = 'agent_session.opened';

export type MessagePosted = {
  message_id: string;
  content: string;
  created_at: string;
  mentions?: Mention[];
  attachments?: unknown[];
  parent: { type: string; id: string };
  root_id: string;
  thread_id?: string | null;
  sender: string;
};

export type SessionOpened = {
  identity: {
    session_id: string;
    session_name: string;
    owner_id: string;
    source?: 'user' | 'agent' | 'routine';
  };
};

export type MacroEvent =
  | { eventId: string; type: typeof MESSAGE_POSTED; metadata: MessagePosted }
  | {
      eventId: string;
      type: typeof AGENT_SESSION_OPENED;
      metadata: SessionOpened;
    }
  | { eventId: string; type: 'other'; eventType: string; metadata: unknown };

export type StreamItem =
  | { kind: 'event'; event: MacroEvent }
  | { kind: 'reconnected'; disconnectedAt: Date };

type Envelope = { event_id: string; event_type: string; metadata?: unknown };

/** Decode one SSE `data` payload (the broker envelope). */
export function parseEnvelope(data: string): MacroEvent {
  const envelope = JSON.parse(data) as Envelope;
  if (
    typeof envelope.event_id !== 'string' ||
    typeof envelope.event_type !== 'string'
  ) {
    throw new Error('event envelope without event_id or event_type');
  }
  const eventId = envelope.event_id;
  if (envelope.event_type === MESSAGE_POSTED) {
    return {
      eventId,
      type: MESSAGE_POSTED,
      metadata: envelope.metadata as MessagePosted,
    };
  }
  if (envelope.event_type === AGENT_SESSION_OPENED) {
    return {
      eventId,
      type: AGENT_SESSION_OPENED,
      metadata: envelope.metadata as SessionOpened,
    };
  }
  return {
    eventId,
    type: 'other',
    eventType: envelope.event_type,
    metadata: envelope.metadata,
  };
}

/** The `data` of each SSE event in a byte stream (multi-line data joined with newlines). */
export async function* sseData(
  bytes: ReadableStream<Uint8Array>,
  onChunk: () => void = () => {}
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  for await (const chunk of bytes) {
    onChunk();
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line === '') {
        if (data.length > 0) yield data.join('\n');
        data = [];
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
      newline = buffer.indexOf('\n');
    }
  }
}

export type StreamDeps = {
  open(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  log(line: object): void;
  now?: () => Date;
  initialDelay?: number;
  maxDelay?: number;
  /** The server sends a keep-alive every 20s; this long without a byte means the connection is dead. */
  idleMilliseconds?: number;
};

/** Yield events until `signal` aborts, reconnecting forever. */
export function eventStream(
  deps: StreamDeps,
  signal: AbortSignal
): AsyncIterable<StreamItem> {
  const items = new AsyncQueue<StreamItem>();
  const now = deps.now ?? (() => new Date());
  const initialDelay = deps.initialDelay ?? 1_000;
  const maxDelay = deps.maxDelay ?? 60_000;
  const idleMilliseconds = deps.idleMilliseconds ?? 60_000;

  const pump = async () => {
    let delay = initialDelay;
    let connectedBefore = false;
    let disconnectedAt: Date | null = null;

    while (!signal.aborted) {
      const connection = new AbortController();
      const stop = () => connection.abort();
      signal.addEventListener('abort', stop, { once: true });
      let idle = setTimeout(stop, idleMilliseconds);
      const alive = () => {
        clearTimeout(idle);
        idle = setTimeout(stop, idleMilliseconds);
      };

      try {
        const bytes = await withSpan(
          'brain.events.connect',
          { 'retry.delay_ms': delay, reconnect: connectedBefore },
          () => deps.open(connection.signal)
        );
        if (disconnectedAt) {
          const gap = startSpan('brain.events.gap', {
            'gap.duration_ms': now().getTime() - disconnectedAt.getTime(),
          });
          gap.end();
        }
        deps.log({ events: 'connected' });
        if (connectedBefore)
          items.push({
            kind: 'reconnected',
            disconnectedAt: disconnectedAt ?? now(),
          });
        connectedBefore = true;
        disconnectedAt = null;

        for await (const data of sseData(bytes, alive)) {
          delay = initialDelay;
          try {
            items.push({ kind: 'event', event: parseEnvelope(data) });
          } catch (error) {
            deps.log({ events: 'undecodable', error: String(error) });
          }
        }
        deps.log({ events: 'ended' });
      } catch (error) {
        if (signal.aborted) break;
        deps.log({
          events: 'failed',
          error: String(error),
          retry_in_ms: delay,
        });
      } finally {
        clearTimeout(idle);
        signal.removeEventListener('abort', stop);
      }
      disconnectedAt ??= now();
      await deps.sleep(delay, signal).catch(() => undefined);
      delay = Math.min(delay * 2, maxDelay);
    }
    items.close();
  };
  pump().catch((error) => {
    deps.log({ events: 'stopped', error: String(error) });
    items.close();
  });
  return items;
}

/** Resolve after `milliseconds`, or reject when `signal` aborts. */
export function abortableSleep(
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Messages a channel timeline page shows that arrived at or after `since` and
 * were not seen live, oldest first, as the `message.posted` they missed.
 */
export function missedMessages(
  channelId: string,
  page: ListedMessage[],
  since: Date,
  seen: (id: string) => boolean
): MessagePosted[] {
  const missed: MessagePosted[] = [];
  const consider = (message: Message, rootId: string) => {
    if (seen(message.id) || new Date(message.created_at) < since) return;
    missed.push({
      message_id: message.id,
      content: message.content,
      created_at: message.created_at,
      mentions: message.mentions ?? [],
      attachments: message.attachments ?? [],
      parent: { type: 'channel', id: channelId },
      root_id: rootId,
      thread_id: message.id === rootId ? null : rootId,
      sender: message.sender_id,
    });
  };
  for (const root of page) {
    consider(root, root.id);
    for (const reply of root.thread?.preview ?? []) consider(reply, root.id);
  }
  return missed.sort((left, right) =>
    left.created_at.localeCompare(right.created_at)
  );
}
