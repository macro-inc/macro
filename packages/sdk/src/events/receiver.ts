import { match, P } from 'ts-pattern';
import type {
  WebhookFilter,
  WebhookScope,
} from '../../generated/storage/types.gen';
import { MacroApiError, MacroError, MacroForbiddenError } from '../utils';
import type { MacroClient } from '../utils/client';
import { hydrateAgentSessionEvent } from './hydrate/agentSession';
import { hydrateCallEvent } from './hydrate/call';
import { hydrateChannelEvent } from './hydrate/channel';
import { hydrateDocumentEvent } from './hydrate/document';
import { hydrateEmailEvent } from './hydrate/email';
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

/**
 * Whether the server refused the subscription itself (bad filters, a
 * credential that may not subscribe), as opposed to a failure worth retrying.
 */
function isRefusal(status: number): boolean {
  // 401 stays retryable: a token source may hand out a fresh token next time.
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

/** Options for {@link MacroEvents.listen}. */
export interface ListenOptions {
  /**
   * Event/entity-id filters, identical to persisted webhook `filters`.
   * Defaults to one filter covering every event currently registered with
   * {@link MacroEvents.on}.
   * For email events, `ids` select inboxes for `email.link_*` and threads
   * for all other events.
   */
  filters?: WebhookFilter[];
  /**
   * Personal or team workspace whose webhook lifecycle events are delivered.
   * Defaults to `'user'`. Email events are private to the inbox owner and
   * arrive only on a personal stream, never a team stream.
   */
  scope?: WebhookScope;
  /** Abort the stream. */
  signal?: AbortSignal;
}

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
    .with({ event_type: P.string.startsWith('email.') }, (emailEvent) =>
      hydrateEmailEvent(client, emailEvent),
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
   * required. Delivery is best-effort: events published before the
   * connection, while disconnected, or dropped for a slow subscriber are
   * missed; there is no replay.
   *
   * Filters default to the event names currently registered with {@link on}.
   * The stream uses those filters for its lifetime; later `.on` / unsubscribe
   * calls do not change what the server sends.
   * Email filters require the inbox owner's user token or API key; bot and
   * harness credentials receive HTTP 403.
   *
   * @returns A function that closes the stream.
   * @throws {MacroApiError} if the server refuses the subscription on the
   *   first connection, such as invalid filters or a credential that may not
   *   subscribe to the requested events ({@link MacroForbiddenError}). A 401
   *   is retried like a network failure.
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

    // The generated SSE client retries every failed connection, so a
    // subscription the server refuses would otherwise retry forever in
    // silence. Watch the first response and fail listen() on a refusal.
    let settleOpened: (refusal?: MacroApiError) => void = () => {};
    const opened = new Promise<void>((resolve, reject) => {
      settleOpened = (refusal) => (refusal ? reject(refusal) : resolve());
    });
    controller.signal.addEventListener('abort', () => settleOpened(), {
      once: true,
    });
    if (controller.signal.aborted) settleOpened();
    let connected = false;
    const watchFirstResponse = async (
      input: Request | URL | string,
      init?: RequestInit,
    ): Promise<Response> => {
      if (connected) return globalThis.fetch(input, init);
      connected = true;
      let response: Response;
      try {
        response = await globalThis.fetch(input, init);
      } catch (error) {
        settleOpened();
        throw error;
      }
      if (isRefusal(response.status)) {
        const data: unknown = await response
          .clone()
          .json()
          .catch(() => undefined);
        settleOpened(
          response.status === 403
            ? new MacroForbiddenError(data)
            : new MacroApiError(response.status, data),
        );
        controller.abort();
      } else {
        settleOpened();
      }
      return response;
    };

    const { stream } = await this.client.storage.streamEvents({
      query: {
        scope: opts.scope ?? 'user',
        filters: JSON.stringify(filters),
      },
      signal: controller.signal,
      fetch: watchFirstResponse as typeof fetch,
      // A failure before any response (such as a token source that throws)
      // is retried by the client; don't hold listen() open for it.
      onSseError: () => settleOpened(),
    });

    const consume = (async () => {
      try {
        for await (const data of stream) {
          await this.dispatchEvent(data);
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

    await opened;

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
