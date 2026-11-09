import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  type EventStreamFilter,
  type StreamedEvent,
  streamViewerEvents,
} from '../queries/document-events';
import {
  type EventMessage,
  type FrameEvent,
  readSubscriptionMessage,
} from './frame-helper';

/** Subscriptions one frame may hold at once. */
export const MAX_SUBSCRIPTIONS = 16;
/** Event names and ids one subscription may list. */
export const MAX_SUBSCRIPTION_ITEMS = 64;
/** Longest wait between reconnects. */
export const MAX_RECONNECT_DELAY_MS = 30_000;
const FIRST_RECONNECT_DELAY_MS = 1_000;

/** `family.action`, as the stream names events (`document.updated`). */
const EVENT_NAME = /^[a-z_]+\.[a-z_]+$/;

/** Where each event family names the entity it is about. */
const ENTITY_ID_FIELDS: Record<string, string> = {
  document: 'document_id',
  channel: 'channel_id',
  call: 'call_id',
  message: 'message_id',
};

export type EventHostOptions = {
  documentId: string;
  token: string;
  /** Replaceable for tests; defaults to the viewer's server event stream. */
  stream?: typeof streamViewerEvents;
};

type Subscription = { events: string[]; ids?: string[] };

/**
 * The entity an event is about, read from its broker envelope by the event's
 * family (`document.updated` → `document_id`). Null for families without one,
 * such as agent sessions.
 */
export function eventEntityId(name: string, data: unknown): string | null {
  const field = ENTITY_ID_FIELDS[name.split('.')[0] ?? ''];
  if (!field || typeof data !== 'object' || data === null) return null;
  const metadata = (data as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value = (metadata as Record<string, unknown>)[field];
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
 * dropped stream reconnects with backoff and sends `macro.resync` to every
 * subscription, because events in the gap are lost. Returns the detach
 * function.
 */
export function attachEventHost(
  frame: HTMLIFrameElement,
  options: EventHostOptions
): () => void {
  const stream = options.stream ?? streamViewerEvents;
  const subscriptions = new Map<number, Subscription>();
  let current: { key: string; controller: AbortController } | undefined;

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
      if (subscription.ids && (id === null || !subscription.ids.includes(id)))
        continue;
      post(key, { type: name, id });
    }
  };

  const resync = () => {
    for (const key of subscriptions.keys())
      post(key, { type: 'macro.resync', id: null });
  };

  async function connect(filters: EventStreamFilter[], signal: AbortSignal) {
    let delay = FIRST_RECONNECT_DELAY_MS;
    let opened = false;
    while (!signal.aborted) {
      const reconnecting = opened;
      await Telemetry.span(
        'block_code.document_events.stream',
        async (span) => {
          span.setAttr('document.id', options.documentId);
          span.setAttr('document_events.filters', filters.length);
          span.setAttr('document_events.reconnect', reconnecting);
          let delivered = 0;
          try {
            await stream({
              filters,
              signal,
              onOpen: () => {
                delay = FIRST_RECONNECT_DELAY_MS;
                opened = true;
                if (reconnecting) resync();
              },
              onEvent: (event) => {
                delivered += 1;
                deliver(event);
              },
            });
          } catch (error) {
            if (!signal.aborted) span.error(error);
          } finally {
            span.setAttr('document_events.delivered', delivered);
          }
        }
      );
      if (signal.aborted) return;
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

  const onMessage = (event: MessageEvent) => {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    const message = readSubscriptionMessage(event.data, options.token);
    if (!message) return;
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
  return () => {
    window.removeEventListener('message', onMessage);
    subscriptions.clear();
    current?.controller.abort();
    current = undefined;
  };
}
