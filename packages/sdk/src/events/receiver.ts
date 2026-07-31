import { Message } from '../entities/channels/message';
import { MacroError, unwrap } from '../utils';
import type { MacroClient } from '../utils/client';
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

// Runtime mirror of `MessageEventName`: any payload naming a message gets a
// hydrated handle.
function hydrate(client: MacroClient, event: MacroEvent): EventMap[EventName] {
  const meta = event.metadata;
  if ('message_id' in meta && 'channel_id' in meta) {
    const mentions = 'mentions' in meta ? meta.mentions : [];
    return {
      metadata: meta,
      message: Message.byId(client, meta.channel_id, meta.message_id, mentions),
    } as EventMap[EventName];
  }
  return { metadata: meta } as EventMap[EventName];
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
  private selfPrincipal?: Promise<string>;

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
   * The caller's identity is resolved lazily (once) on the first delivery,
   * and deliveries mentioning anyone else are ignored — so this stays correct
   * even when the receiving webhook is broader than one entity (no `ids`
   * filter, or several subscribers sharing an endpoint). The webhook itself
   * is registered separately and once, e.g. `macro.webhooks.create({
   * filters: [{ events: ['channel.mentioned'], ids: [<own principal>] }],
   * … })`.
   *
   * @returns An unsubscribe function.
   */
  onSelfMention(handler: EventHandler<'channel.mentioned'>): () => void {
    return this.on('channel.mentioned', async (event) => {
      if (event.metadata.mentioned.entity_id !== (await this.myPrincipal())) {
        return;
      }
      await handler(event);
    });
  }

  /**
   * The authenticated caller's mentionable principal — `bot|<uuid>` for bot
   * auth, `macro|<email>` for user auth — fetched once and cached.
   */
  private myPrincipal(): Promise<string> {
    this.selfPrincipal ??= (async () => {
      if (this.client.authConfig.type === 'bot') {
        const bot = unwrap(await this.client.storage.getSelfBot());
        return `bot|${bot.id}`;
      }
      const { user_id } = unwrap(await this.client.auth.getUserInfo());
      return user_id;
    })().catch((error) => {
      // Don't cache failures: the next delivery retries the lookup.
      this.selfPrincipal = undefined;
      throw error;
    });
    return this.selfPrincipal;
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
    const set = this.handlers.get(event.event_type);
    if (!set || set.size === 0) return;

    const payload = hydrate(this.client, event);
    await Promise.all([...set].map((handler) => handler(payload)));
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
