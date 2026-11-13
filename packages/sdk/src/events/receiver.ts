import { match, P } from 'ts-pattern';
import type {
  CatalogEntry,
  WebhookFilter,
  WebhookScope,
} from '../../generated/storage/types.gen';
import type { MacroClient } from '../utils/client';
import { MacroError, unwrap } from '../utils/unwrap';
import { hydrateAgentSessionEvent } from './hydrate/agentSession';
import { hydrateBotEvent } from './hydrate/bot';
import { hydrateCalendarEvent } from './hydrate/calendar';
import { hydrateCallEvent } from './hydrate/call';
import { hydrateCallRecordEvent } from './hydrate/callRecord';
import { hydrateChannelEvent } from './hydrate/channel';
import { hydrateChatEvent } from './hydrate/chat';
import { hydrateDatabaseEvent } from './hydrate/database';
import { hydrateDocumentEvent } from './hydrate/document';
import { hydrateEmailEvent } from './hydrate/email';
import { hydrateFormEvent } from './hydrate/form';
import { hydrateInitiativeEvent } from './hydrate/initiative';
import { hydrateMessageEvent } from './hydrate/message';
import { hydrateNotificationEvent } from './hydrate/notification';
import { hydrateProjectEvent } from './hydrate/project';
import { hydratePropertyEvent } from './hydrate/property';
import { hydrateUserEvent } from './hydrate/user';
import { EventStream, EventStreamRevokedError } from './subscribe';
import type {
  DeliveryHeaders,
  EventHandler,
  EventMap,
  EventName,
  EventPattern,
  MacroEvent,
  MatchedEventName,
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
   * Called once if the listener stops on its own: the server refused the
   * stream (bad filters, no access), a handler threw, or the credential was
   * revoked and cannot refresh ({@link EventStreamRevokedError}). Without it
   * the SDK logs the error with `console.error`.
   */
  onError?: (error: unknown) => void;
}

/** Options for {@link MacroEvents.subscribe}. */
export interface SubscribeOptions<P extends EventPattern> {
  /**
   * Event names to receive: exact names, family wildcards such as
   * `'document.*'`, or `'*'`. Wildcards need the `public-event-stream` beta;
   * without it they match nothing.
   */
  events: readonly P[];
  /** Only events about these items (any handles: channels, documents, ...). */
  ids?: readonly { readonly id: string }[];
  /** Only events whose entity type is one of these, such as `'document'`. */
  entityTypes?: readonly string[];
  /**
   * Resume after this position: a `stream.cursor` saved earlier. Events
   * within the replay window (about an hour) are delivered again from there.
   */
  cursor?: string;
  /**
   * Personal or team workspace whose webhook lifecycle events are delivered.
   * Defaults to `'user'`.
   */
  scope?: WebhookScope;
  /** Abort the stream; the loop ends without an error. */
  signal?: AbortSignal;
}

/** A hydrated event delivered by {@link MacroEvents.subscribe}. */
export type SubscribedEvent<P extends EventPattern> =
  EventMap[MatchedEventName<P>];

/**
 * Attach the entity handles defined for each event. A family without a
 * hydrator is delivered as its raw `metadata`.
 */
function hydrate(
  client: MacroClient,
  event: MacroEvent,
): EventMap[EventName] | undefined {
  // A hydrator arm serving several names returns one object whose
  // `event_type` is their union; `EventMap` re-narrows it per name.
  const hydrated: object | undefined = match(event)
    .with({ event_type: P.string.startsWith('document.') }, (documentEvent) =>
      hydrateDocumentEvent(client, documentEvent),
    )
    .with(
      { event_type: P.string.startsWith('call.record_') },
      (callRecordEvent) => hydrateCallRecordEvent(client, callRecordEvent),
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
    .with({ event_type: P.string.startsWith('project.') }, (projectEvent) =>
      hydrateProjectEvent(client, projectEvent),
    )
    .with({ event_type: P.string.startsWith('chat.') }, (chatEvent) =>
      hydrateChatEvent(client, chatEvent),
    )
    .with({ event_type: P.string.startsWith('database.') }, (databaseEvent) =>
      hydrateDatabaseEvent(client, databaseEvent),
    )
    .with({ event_type: P.string.startsWith('form.') }, (formEvent) =>
      hydrateFormEvent(client, formEvent),
    )
    .with(
      { event_type: P.string.startsWith('initiative.') },
      (initiativeEvent) => hydrateInitiativeEvent(client, initiativeEvent),
    )
    .with(
      {
        event_type: P.union(
          P.string.startsWith('entity_property.'),
          P.string.startsWith('entity_properties.'),
          P.string.startsWith('property.'),
          P.string.startsWith('property_option.'),
        ),
      },
      (propertyEvent) => hydratePropertyEvent(client, propertyEvent),
    )
    .with({ event_type: P.string.startsWith('email.') }, (emailEvent) =>
      hydrateEmailEvent(client, emailEvent),
    )
    .with(
      { event_type: P.string.startsWith('calendar_event.') },
      (calendarEvent) => hydrateCalendarEvent(client, calendarEvent),
    )
    .with(
      { event_type: P.string.startsWith('notification.') },
      (notificationEvent) =>
        hydrateNotificationEvent(client, notificationEvent),
    )
    .with({ event_type: P.string.startsWith('bot.') }, (botEvent) =>
      hydrateBotEvent(client, botEvent),
    )
    .otherwise((raw) => raw);
  // A member a hydrator does not know yet (newer server) arrives raw.
  return (hydrated ?? event) as EventMap[EventName];
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
   * Read live events with `for await`, resuming after restarts from a saved
   * `stream.cursor`. Beta: cursors, replay, wildcards and preview families
   * need the `public-event-stream` flag; without it the stream is live only.
   *
   * The stream reconnects by itself (with backoff, resuming from its cursor)
   * and never yields one `event_id` twice. Events of one item arrive in
   * order; there is no order across items. It throws
   * {@link EventStreamResetError} when the cursor is older than the replay
   * window: resync through the list APIs, then subscribe without a cursor.
   * It ends without an error when `signal` aborts, the loop breaks, or the
   * server revokes the credential (`stream.closeReason === 'revoked'`).
   *
   * @example
   * const stream = macro.events.subscribe({ events: ['document.*'], cursor: saved });
   * for await (const event of stream) {
   *   if (event.event_type === 'document.created') console.log(event.document.id);
   *   await save(stream.cursor);
   * }
   *
   * @beta
   * @mcp-exclude Holds a live event stream open; MCP calls carry JSON only.
   */
  subscribe<P extends EventPattern>(
    options: SubscribeOptions<P>,
  ): EventStream<SubscribedEvent<P>> {
    if (options.events.length === 0) {
      throw new MacroError('subscribe() needs at least one event name');
    }
    const filter: WebhookFilter = { events: [...options.events] };
    if (options.ids) filter.ids = options.ids.map((item) => item.id);
    if (options.entityTypes) filter.entity_types = [...options.entityTypes];
    return new EventStream(
      this.client,
      {
        filters: [filter],
        scope: options.scope ?? 'user',
        cursor: options.cursor,
        signal: options.signal,
      },
      (event) => hydrate(this.client, event) as SubscribedEvent<P> | undefined,
    );
  }

  /**
   * The events this credential can receive, with their entity types, who
   * receives them and their rollout stage. Beta: needs the
   * `public-event-stream` flag (404 without it).
   *
   * @beta
   * @readonly
   */
  async catalog(): Promise<CatalogEntry[]> {
    const catalog = unwrap(await this.client.storage.eventCatalog());
    return catalog.events;
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
   * required. It runs on the same stream as {@link subscribe}: it reconnects
   * by itself and, with the `public-event-stream` beta, resumes from its
   * cursor so a reconnect inside the replay window misses nothing. Without
   * the beta delivery is best-effort: events published while disconnected
   * are missed. If the cursor expires it continues live from now.
   *
   * The server re-checks the credential every minute and closes the stream
   * when it no longer validates. With a token function (`token: () => ...`)
   * the listener reconnects with a freshly resolved token. It stops and
   * reports {@link EventStreamRevokedError} to `onError` with a fixed token,
   * when its bot was deleted, or after 3 revoked closes in a row that each
   * came within 2 minutes of connecting with no event between them (the
   * refreshed tokens are not accepted either). Ordinary expiries of a working
   * token, on a quiet stream too, never count.
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

    const stream = new EventStream(
      this.client,
      {
        filters,
        scope: opts.scope ?? 'user',
        signal: opts.signal,
        resetToLive: true,
        // A token function is resolved again on every reconnect, so a
        // revoked (expired) stream resumes with the refreshed token.
        reconnectOnRevoked: typeof this.client.authConfig.token === 'function',
      },
      (event) => event,
    );
    const report =
      opts.onError ??
      ((error: unknown) => {
        console.error('macro sdk: event listener stopped', error);
      });
    const _consumed = (async () => {
      try {
        for await (const event of stream) {
          await this.dispatch(event);
        }
        if (stream.closeReason === 'revoked') {
          report(new EventStreamRevokedError(stream.revokeReason));
        }
      } catch (error) {
        // Never an unhandled rejection: listen() has already returned, and
        // the caller has `stop`.
        report(error);
      }
    })();

    return () => {
      stream.close();
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
    await this.dispatch(event as MacroEvent);
  }

  private async dispatch(typed: MacroEvent): Promise<void> {
    const handlers = this.handlers.get(typed.event_type);
    if (!handlers || handlers.size === 0) return;

    const payload = hydrate(this.client, typed);
    if (!payload) return;
    await Promise.all([...handlers].map((handler) => handler(payload)));
  }
}
