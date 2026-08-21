import { match, P } from 'ts-pattern';
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

/** Attach the entity handles defined for each webhook event. */
function hydrate(client: MacroClient, event: MacroEvent): EventMap[EventName] {
  return match(event)
    .with({ event_type: P.string.startsWith('document.') }, (documentEvent) =>
      hydrateDocumentEvent(client, documentEvent),
    )
    .with({ event_type: P.string.startsWith('channel.') }, (channelEvent) =>
      hydrateChannelEvent(client, channelEvent),
    )
    .exhaustive();
}

/**
 * Per-instance webhook receiver. Register ONE webhook with Macro (one URL, one
 * signing secret) and mount this receiver at it; all `.on` handlers fan out
 * from here.
 *
 * Obtain via `macro.events` — do not construct directly.
 */
export class MacroEvents {
  private readonly handlers = new Map<EventName, Set<AnyHandler>>();

  constructor(
    private readonly client: MacroClient,
    private readonly secret: string,
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
   * webhook's workspace can access (its `ids` filter, like all channel
   * events, holds channel ids); picking out "me" happens here, client-side.
   * The caller's identity is resolved lazily (once) on the first delivery.
   * The webhook itself is registered separately and once, e.g.
   * `macro.webhooks.create({ filters: [{ events: ['channel.mentioned'] }],
   * … })`.
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
   * Feed a raw delivery in: verifies the signature, parses, and dispatches to
   * matching handlers.
   *
   * @throws {MacroError} if the signature is missing or invalid.
   */
  async handle(rawBody: string, headers: DeliveryHeaders): Promise<void> {
    const ok = await verifySignature({
      secret: this.secret,
      timestamp: headers.timestamp ?? '',
      rawBody,
      signature: headers.signature ?? '',
    });
    if (!ok) throw new MacroError('invalid webhook signature');

    if (headers.event === VALIDATION_EVENT) return;

    const event = JSON.parse(rawBody) as MacroEvent;
    if (!('event_type' in event)) return;
    const handlers = this.handlers.get(event.event_type);
    if (!handlers || handlers.size === 0) return;

    const payload = hydrate(this.client, event);
    await Promise.all([...handlers].map((handler) => handler(payload)));
  }

  /**
   * A Fetch-style handler to mount at your webhook route.
   *
   * @example
   * app.post('/webhook', macro.events.webhook()); // Hono
   */
  webhook(): (req: Request) => Promise<Response> {
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
}
