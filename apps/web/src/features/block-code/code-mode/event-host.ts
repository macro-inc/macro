import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  type EventStreamFilter,
  EventStreamRefused,
  type StreamedEvent,
  streamViewerEvents,
} from '../queries/document-events';
import {
  type EventMessage,
  type FrameEvent,
  type PreviewFrame,
  readSubscriptionMessage,
} from './frame-helper';

/** Subscriptions one frame may hold at once. */
export const MAX_SUBSCRIPTIONS = 16;
/** Event names and ids one subscription may list. */
export const MAX_SUBSCRIPTION_ITEMS = 64;
/** Longest entity id a subscription may list, as the server accepts. */
export const MAX_ID_LENGTH = 256;
/** Longest wait between reconnects. */
export const MAX_RECONNECT_DELAY_MS = 30_000;
const FIRST_RECONNECT_DELAY_MS = 1_000;

/** `family.action`, as the stream names events (`document.updated`). */
const EVENT_NAME = /^[a-z_]+\.[a-z_]+$/;

/**
 * Where each event family's broker envelope names the entity the server
 * filters `ids` by: a message event is about its conversation's parent (the
 * channel or document), not the message.
 */
const ENTITY_ID_FIELDS: Record<
  string,
  (metadata: Record<string, unknown>) => unknown
> = {
  document: (metadata) => metadata.document_id,
  channel: (metadata) => metadata.channel_id,
  call: (metadata) => metadata.call_id,
  webhook: (metadata) => metadata.webhook_id,
  agent_trigger: (metadata) => metadata.bot_id,
  agent_session: (metadata) => {
    const identity = metadata.identity;
    if (typeof identity !== 'object' || identity === null) return null;
    return (identity as { session_id?: unknown }).session_id;
  },
  message: (metadata) => {
    const parent = metadata.parent;
    if (typeof parent !== 'object' || parent === null) return null;
    return (parent as { id?: unknown }).id;
  },
};

export type EventHostOptions = {
  documentId: string;
  token: string;
  /** Replaceable for tests; defaults to the viewer's server event stream. */
  stream?: typeof streamViewerEvents;
};

type Subscription = { events: string[]; ids?: string[] };

/**
 * The entity an event is about, as the server's `ids` filter reads it, from
 * its broker envelope by the event's family (`document.updated` →
 * `document_id`, `message.posted` → its parent's id). Null for unknown
 * families or malformed envelopes.
 */
export function eventEntityId(name: string, data: unknown): string | null {
  const read = ENTITY_ID_FIELDS[name.split('.')[0] ?? ''];
  if (!read || typeof data !== 'object' || data === null) return null;
  const metadata = (data as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value = read(metadata as Record<string, unknown>);
  return typeof value === 'string' ? value : null;
}

function refusal(subscription: Subscription): string | undefined {
  if (subscription.events.length === 0) return 'macro.on needs an event name.';
  if (
    subscription.events.length > MAX_SUBSCRIPTION_ITEMS ||
    (subscription.ids?.length ?? 0) > MAX_SUBSCRIPTION_ITEMS
  )
    return `A subscription lists at most ${MAX_SUBSCRIPTION_ITEMS} events and ${MAX_SUBSCRIPTION_ITEMS} ids.`;
  const invalid = subscription.events.find((name) => !EVENT_NAME.test(name));
  if (invalid)
    return `“${invalid}” is not an event name like document.updated.`;
  if (subscription.ids?.length === 0)
    return 'macro.on’s ids lists no entity; leave ids out to hear about every entity.';
  if (
    subscription.ids?.some(
      (id) => id.trim().length === 0 || id.length > MAX_ID_LENGTH
    )
  )
    return `Each id in macro.on’s ids must be a nonblank entity id of at most ${MAX_ID_LENGTH} characters.`;
  return undefined;
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Answer a preview frame's `macro.on` subscriptions from one server event
 * stream whose filters are the union of the frame's subscriptions, reopened
 * when they change. Only the event name and entity id reach the frame. A
 * stream that drops reconnects with backoff, and every open after the
 * frame's first (a reconnect, a reopen for changed subscriptions, or a first
 * open after failed attempts) sends `macro.resync` to every subscription,
 * because events in the gap are lost. A stream the server refuses is not
 * retried: each subscription gets `macro.error`. A page loaded afresh in a
 * new window (the frame moved in the document) starts with no
 * subscriptions. Returns the detach function.
 */
export function attachEventHost(
  frame: PreviewFrame,
  options: EventHostOptions
): () => void {
  const stream = options.stream ?? streamViewerEvents;
  const subscriptions = new Map<number, Subscription>();
  let current: { key: string; controller: AbortController } | undefined;
  // Until a stream has opened, or an attempt has failed, the frame has
  // missed nothing; every open after that may have.
  let missedNothing = true;
  // The window whose page made these subscriptions. A frame moved in the
  // document loads its page afresh in a new window, which starts over.
  let owner: Window | null = null;

  const post = (subscription: number, event: FrameEvent) => {
    const message: EventMessage = {
      type: 'macro:event',
      token: options.token,
      subscription,
      event,
    };
    frame.contentWindow?.postMessage(message, '*');
  };

  const deliver = ({ name, data }: StreamedEvent) => {
    const id = eventEntityId(name, data);
    for (const [key, subscription] of subscriptions) {
      if (!subscription.events.includes(name)) continue;
      // The server filters the union, so every handler still needs its own
      // match. An unreadable id cannot satisfy an id-scoped subscription.
      if (subscription.ids && (id === null || !subscription.ids.includes(id)))
        continue;
      post(key, { type: name, id });
    }
  };

  const postToAll = (event: FrameEvent) => {
    for (const key of subscriptions.keys()) post(key, event);
  };

  async function connect(filters: EventStreamFilter[], signal: AbortSignal) {
    let delay = FIRST_RECONNECT_DELAY_MS;
    while (!signal.aborted) {
      const refused = await Telemetry.span(
        'block_code.document_events.stream',
        async (span) => {
          span.setAttr('document.id', options.documentId);
          span.setAttr('document_events.filters', filters.length);
          span.setAttr('document_events.reconnect', !missedNothing);
          const traceHeaders: Record<string, string> = {};
          span.injectTraceHeaders(traceHeaders);
          let delivered = 0;
          try {
            await stream({
              filters,
              signal,
              traceHeaders,
              onOpen: () => {
                delay = FIRST_RECONNECT_DELAY_MS;
                if (!missedNothing)
                  postToAll({ type: 'macro.resync', id: null });
                missedNothing = false;
              },
              onEvent: (event) => {
                delivered += 1;
                deliver(event);
              },
            });
            return false;
          } catch (error) {
            if (signal.aborted) return false;
            span.error(error);
            missedNothing = false;
            return error instanceof EventStreamRefused;
          } finally {
            span.setAttr('document_events.delivered', delivered);
          }
        }
      );
      if (signal.aborted) return;
      if (refused) {
        postToAll({
          type: 'macro.error',
          id: null,
          message:
            'Macro refused this page’s live events; change its macro.on subscriptions.',
        });
        return;
      }
      await pause(delay, signal);
      delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    }
  }

  const reconcile = () => {
    const filters: EventStreamFilter[] = [...subscriptions.values()].map(
      ({ events, ids }) => (ids ? { events, ids } : { events })
    );
    const key = JSON.stringify(filters);
    if (current?.key === key) return;
    current?.controller.abort();
    current = undefined;
    if (filters.length === 0) return;
    const controller = new AbortController();
    current = { key, controller };
    // Each connection records its own failure; the loop itself never rejects.
    fireAndForget(
      connect(filters, controller.signal),
      'block_code.document_events'
    );
  };

  const adopt = (page: Window) => {
    if (page === owner) return;
    owner = page;
    subscriptions.clear();
    missedNothing = true;
    reconcile();
  };

  const onLoad = () => {
    if (owner && frame.contentWindow && frame.contentWindow !== owner)
      adopt(frame.contentWindow);
  };

  const onMessage = (event: MessageEvent) => {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    const message = readSubscriptionMessage(event.data, options.token);
    if (!message) return;
    adopt(frame.contentWindow);
    if (message.type === 'macro:unsubscribe') {
      if (subscriptions.delete(message.subscription)) reconcile();
      return;
    }
    const subscription: Subscription = {
      events: [...new Set(message.events)],
      ...(message.ids ? { ids: [...new Set(message.ids)] } : {}),
    };
    const refused =
      subscriptions.size >= MAX_SUBSCRIPTIONS &&
      !subscriptions.has(message.subscription)
        ? `A page can hold at most ${MAX_SUBSCRIPTIONS} subscriptions.`
        : refusal(subscription);
    if (refused) {
      post(message.subscription, {
        type: 'macro.error',
        id: null,
        message: refused,
      });
      return;
    }
    subscriptions.set(message.subscription, subscription);
    reconcile();
  };

  window.addEventListener('message', onMessage);
  frame.addEventListener('load', onLoad);
  return () => {
    window.removeEventListener('message', onMessage);
    frame.removeEventListener('load', onLoad);
    subscriptions.clear();
    current?.controller.abort();
    current = undefined;
  };
}
