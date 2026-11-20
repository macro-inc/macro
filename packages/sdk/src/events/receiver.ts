import { match, P } from 'ts-pattern';
import type {
  WebhookFilter,
  WebhookScope,
} from '../../generated/storage/types.gen';
import { MacroError } from '../utils';
import type { MacroClient } from '../utils/client';
import { hydrateAgentSessionEvent } from './hydrate/agentSession';
import { hydrateCallEvent } from './hydrate/call';
import { hydrateChannelEvent } from './hydrate/channel';
import { hydrateDocumentEvent } from './hydrate/document';
import { hydrateMessageEvent } from './hydrate/message';
import { hydrateUserEvent } from './hydrate/user';
import type {
  DeliveryHeaders,
  EventHandler,
  EventMap,
  EventName,
  MacroEvent,
} from './types';
import { verifySignature } from './verify';

type AnyHandler = (event: unknown) => void | Promise<void>;

/** Sent by Macro when validating a newly registered endpoint; acked, never dispatched. */
const VALIDATION_EVENT = 'webhook.validation.test';

/** Options for {@link MacroEvents.listen}. */
export interface ListenOptions {
  /**
   * Event/entity-id filters, identical to persisted webhook `filters`.
   * Defaults to one filter covering every event currently registered with
   * {@link MacroEvents.on}.
   */
  filters?: WebhookFilter[];
  /**
   * Personal or team workspace whose webhook lifecycle events are delivered.
   * Defaults to `'user'`.
   */
  scope?: WebhookScope;
  /** Abort the stream. */
  signal?: AbortSignal;
  /**
   * Told once each time an open stream drops (the server closed it, as a
   * restart or deploy does, or the connection failed), before it reconnects
   * on its own; failed reconnect attempts while it is down aren't told.
   * Events published while it was down are not replayed, unless `resume`
   * catches a short gap: resync them from history from `at` after `onOpen`,
   * e.g. with a channel's `messagesAfter`.
   */
  onDrop?: (at: Date) => void;
  /**
   * Told each time the stream opens: the first time, and again after each
   * drop, once events reach the handlers again. Resync after a reopen, not
   * at the drop: an event published between a resync and the reopen would
   * reach neither.
   */
  onOpen?: (at: Date) => void;
  /**
   * Ask the server to replay the events after the last one seen, on the
   * first connection (`lastEventId`, e.g. stored by a process before it
   * restarted) and on each reconnect. The server keeps only a short window
   * of recent events, in one process, and doesn't say when a gap was longer:
   * resync from history as well, and expect repeats (drop them by id).
   */
  resume?: { readonly lastEventId?: string };
  /**
   * Told each event's id once its handlers are done, whether or not they
   * succeeded (an event that always fails must not be replayed forever), to
   * resume from later.
   */
  onEventId?: (id: string) => void;
  /** Told when a handler throws or rejects; the stream goes on. */
  onHandlerError?: (error: unknown) => void;
}

/** Runs a caller's callback without letting it break the stream. */
const safely =
  <Args extends unknown[]>(callback: ((...args: Args) => void) | undefined) =>
  (...args: Args): void => {
    try {
      callback?.(...args);
    } catch {
      // The caller's to handle: a callback must not end the stream.
    }
  };

/** Attach the entity handles defined for each webhook event. */
function hydrate(
  client: MacroClient,
  event: MacroEvent,
): EventMap[EventName] | undefined {
  return match(event)
    .with({ event_type: P.string.startsWith('document.') }, (documentEvent) =>
      hydrateDocumentEvent(client, documentEvent),
    )
    .with({ event_type: P.string.startsWith('call.') }, (callEvent) =>
      hydrateCallEvent(client, callEvent),
    )
    .with({ event_type: P.string.startsWith('channel.') }, (channelEvent) =>
      hydrateChannelEvent(client, channelEvent),
    )
    .with({ event_type: P.string.startsWith('message.') }, (messageEvent) =>
      hydrateMessageEvent(client, messageEvent),
    )
    .with({ event_type: P.string.startsWith('user.') }, (userEvent) =>
      hydrateUserEvent(client, userEvent),
    )
    .with(
      { event_type: P.string.startsWith('agent_session.') },
      (agentSessionEvent) =>
        hydrateAgentSessionEvent(client, agentSessionEvent),
    )
    .otherwise(() => undefined);
}

/**
 * Per-instance event receiver. Subscribe with {@link MacroEvents.on}, then
 * either {@link MacroEvents.listen} (SSE, the default) or mount
 * {@link MacroEvents.webhook} at a persisted webhook URL.
 *
 * Obtain via `macro.events` — do not construct directly.
 *
 * @mcp-exclude Registers live event handlers and listeners; MCP calls carry JSON only.
 */
export class MacroEvents {
  private readonly handlers = new Map<EventName, Set<AnyHandler>>();

  constructor(
    private readonly client: MacroClient,
    private readonly secret?: string,
  ) {}

  /**
   * Subscribe to an event across all entities.
   *
   * @returns An unsubscribe function.
   */
  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    const set = this.handlers.get(event) ?? new Set<AnyHandler>();
    set.add(handler as AnyHandler);
    this.handlers.set(event, set);
    return () => set.delete(handler as AnyHandler);
  }

  /**
   * Subscribe to @-mentions of the authenticated caller: `message.mentioned`
   * deliveries whose mentioned entity is this bot (bot auth) or this user
   * (user auth), in channels and in document comments alike.
   *
   * `message.mentioned` deliveries cover every mention the stream's (or
   * webhook's) workspace can access (its `ids` filter holds channel or
   * document ids); picking out "me" happens here, client-side. The caller's
   * identity is resolved lazily (once) on the first delivery.
   *
   * For SSE, register this handler before {@link listen} so the derived
   * filters include `message.mentioned`. For persisted webhooks, register the
   * webhook separately, e.g. `macro.webhooks.create({ filters: [{ events:
   * ['message.mentioned'] }], … })`.
   *
   * @returns An unsubscribe function.
   */
  onSelfMention(handler: EventHandler<'message.mentioned'>): () => void {
    return this.on('message.mentioned', async (event) => {
      // Principals embed emails for users; emails are case-insensitive.
      const mentioned = event.metadata.mentioned.entity_id.toLowerCase();
      if (mentioned !== (await this.client.myPrincipalId()).toLowerCase()) {
        return;
      }
      await handler(event);
    });
  }

  /**
   * Open a live Server-Sent Events stream of matching broker events. This is
   * the default way to receive events — no public URL or signing secret
   * required. It reconnects on its own when the server ends it or the
   * connection fails. Delivery is best-effort: events published before the
   * connection, while it was down, or dropped for a slow subscriber are
   * missed, unless `resume` replays them from the server's short, per-process
   * window. Resync from history after `onOpen` reports a reopen.
   *
   * A handler that throws doesn't end the stream: the error goes to
   * `onHandlerError`. The callbacks in `opts` must not throw; one that does
   * is ignored.
   *
   * Filters default to the event names currently registered with {@link on}.
   * The stream uses those filters for its lifetime; later `.on` / unsubscribe
   * calls do not change what the server sends.
   *
   * @returns A function that closes the stream.
   */
  async listen(opts: ListenOptions = {}): Promise<() => void> {
    const filters = opts.filters ?? this.filtersFromHandlers();
    if (
      filters.length === 0 ||
      filters.every((filter) => filter.events.length === 0)
    ) {
      throw new MacroError(
        'listen() needs filters — pass filters or register handlers with .on() first',
      );
    }

    const controller = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) {
        controller.abort();
      } else {
        opts.signal.addEventListener('abort', () => controller.abort(), {
          once: true,
        });
      }
    }

    let lastId: string | undefined;
    // Told once per drop, not once per failed reconnect attempt.
    let open = false;
    const onOpen = safely(opts.onOpen);
    const onDrop = safely(opts.onDrop);
    const onEventId = safely(opts.onEventId);
    const onHandlerError = safely(opts.onHandlerError);
    // The generated client sends back the last id it saw on a reconnect; the
    // server replays from it only when asked to resume.
    const resuming = (request: Request): Request => {
      if (opts.resume === undefined) return request;
      const url = new URL(request.url);
      url.searchParams.set('resume', 'true');
      const headers = new Headers(request.headers);
      const from = opts.resume.lastEventId;
      if (!headers.has('Last-Event-ID') && from !== undefined)
        headers.set('Last-Event-ID', from);
      // Everything else (credentials, signal, ...) is kept from the original.
      return new Request(url, new Request(request, { headers }));
    };
    const { stream } = await this.client.storage.streamEvents({
      query: {
        scope: opts.scope ?? 'user',
        filters: JSON.stringify(filters),
      },
      signal: controller.signal,
      // The generated client reconnects by itself; each successful response
      // is the stream open.
      fetch: Object.assign(
        async (...request: Parameters<typeof fetch>) => {
          const response = await globalThis.fetch(
            resuming(new Request(...request)),
          );
          if (response.ok) {
            open = true;
            onOpen(new Date());
          }
          return response;
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
      onSseEvent: (event) => {
        lastId = event.id;
      },
      onSseError: () => {
        if (controller.signal.aborted || !open) return;
        open = false;
        onDrop(new Date());
      },
    });

    const consume = (async () => {
      try {
        for await (const data of stream) {
          // The client reads an event's id just before yielding it.
          const id = lastId;
          try {
            await this.dispatchEvent(data);
          } catch (error) {
            onHandlerError(error);
          }
          if (id !== undefined) onEventId(id);
        }
      } catch {
        if (controller.signal.aborted) return;
        throw new MacroError('event stream failed');
      }
    })();
    consume.catch(() => {
      // Connection errors are retried by the generated SSE client. A terminal
      // failure after listen() has returned must not become an unhandled
      // rejection; the caller already has `stop`.
    });

    return () => {
      controller.abort();
    };
  }

  /**
   * Feed a raw webhook delivery in: verifies the signature, parses, and
   * dispatches to matching handlers.
   *
   * @throws {MacroError} if no signing secret was configured, or if the
   *   signature is missing or invalid.
   */
  async handle(rawBody: string, headers: DeliveryHeaders): Promise<void> {
    if (!this.secret) {
      throw new MacroError(
        'webhookSecret is required to verify incoming webhook deliveries',
      );
    }
    const ok = await verifySignature({
      secret: this.secret,
      timestamp: headers.timestamp ?? '',
      rawBody,
      signature: headers.signature ?? '',
    });
    if (!ok) throw new MacroError('invalid webhook signature');

    if (headers.event === VALIDATION_EVENT) return;

    await this.dispatchEvent(JSON.parse(rawBody));
  }

  /**
   * A Fetch-style handler to mount at your persisted webhook route.
   *
   * Requires `webhookSecret` (or `MACRO_WEBHOOK_SECRET`).
   *
   * @example
   * app.post('/webhook', macro.events.webhook()); // Hono
   */
  webhook(): (req: Request) => Promise<Response> {
    if (!this.secret) {
      throw new MacroError(
        'webhookSecret is required to verify incoming webhook deliveries',
      );
    }
    return async (req: Request) => {
      await this.handle(await req.text(), {
        event: req.headers.get('x-macro-event') ?? undefined,
        eventId: req.headers.get('x-macro-event-id') ?? undefined,
        timestamp: req.headers.get('x-macro-timestamp') ?? undefined,
        signature: req.headers.get('x-macro-signature') ?? undefined,
      });
      return new Response('ok');
    };
  }

  private filtersFromHandlers(): WebhookFilter[] {
    const events = [...this.handlers.entries()]
      .filter(([, set]) => set.size > 0)
      .map(([name]) => name);
    return events.length > 0 ? [{ events }] : [];
  }

  private async dispatchEvent(data: unknown): Promise<void> {
    const event =
      typeof data === 'string' ? (JSON.parse(data) as unknown) : data;
    if (
      event === null ||
      typeof event !== 'object' ||
      !('event_type' in event)
    ) {
      return;
    }
    const typed = event as MacroEvent;
    const handlers = this.handlers.get(typed.event_type);
    if (!handlers || handlers.size === 0) return;

    const payload = hydrate(this.client, typed);
    if (!payload) return;
    await Promise.all([...handlers].map((handler) => handler(payload)));
  }
}
