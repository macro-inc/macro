import { match, P } from 'ts-pattern';
import type {
  WebhookFilter,
  WebhookScope,
} from '../../generated/storage/types.gen';
import { MacroError } from '../utils';
import type { MacroClient } from '../utils/client';
import { hydrateChannelEvent } from './hydrate/channel';
import { hydrateDocumentEvent } from './hydrate/document';
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
    .with({ event_type: P.string.startsWith('channel.') }, (channelEvent) =>
      hydrateChannelEvent(client, channelEvent),
    )
    .otherwise(() => undefined);
}

/**
 * Per-instance event receiver. Subscribe with {@link MacroEvents.on}, then
 * either {@link MacroEvents.listen} (SSE, the default) or mount
 * {@link MacroEvents.webhook} at a persisted webhook URL.
 *
 * Obtain via `macro.events` — do not construct directly.
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
   * Subscribe to @-mentions of the authenticated caller: `channel.mentioned`
   * deliveries whose mentioned entity is this bot (bot auth) or this user
   * (user auth).
   *
   * `channel.mentioned` deliveries cover every mention in channels the
   * stream's (or webhook's) workspace can access (its `ids` filter, like all
   * channel events, holds channel ids); picking out "me" happens here,
   * client-side. The caller's identity is resolved lazily (once) on the first
   * delivery.
   *
   * For SSE, register this handler before {@link listen} so the derived
   * filters include `channel.mentioned`. For persisted webhooks, register the
   * webhook separately, e.g. `macro.webhooks.create({ filters: [{ events:
   * ['channel.mentioned'] }], … })`.
   *
   * @returns An unsubscribe function.
   */
  onSelfMention(handler: EventHandler<'channel.mentioned'>): () => void {
    return this.on('channel.mentioned', async (event) => {
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

    const { stream } = await this.client.storage.streamEvents({
      query: {
        scope: opts.scope ?? 'user',
        filters: JSON.stringify(filters),
      },
      signal: controller.signal,
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
