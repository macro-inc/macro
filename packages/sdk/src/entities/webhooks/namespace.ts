import type {
  WebhookFilter,
  WebhookScope,
} from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { BotsNamespace } from '../bots/namespace';
import { Webhook } from './webhook';

/**
 * Webhook registrations for receiving signed entity-event deliveries.
 */
export class WebhooksNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Register a webhook. `filters` must be non-empty (each entry matches event
   * names, optionally narrowed to entity ids); `scope` defaults to `'user'`.
   */
  create(opts: {
    url: string;
    name: string;
    filters: WebhookFilter[];
    scope?: WebhookScope;
    headers?: Record<string, string>;
  }): Promise<Webhook> {
    return Webhook.create(this.client, opts);
  }

  /**
   * Register a webhook that delivers `channel.bot_mentioned` events for THIS
   * bot — "notify me when I am @-mentioned". Bot auth only: the bot's own id
   * is resolved automatically and baked into the filter, so with a user API
   * key this throws (there is no user-mention webhook event).
   *
   * Handle deliveries with `macro.events.on('channel.bot_mentioned', …)`, and
   * save the returned handle's `signingSecret` (only ever returned here) as
   * `MacroOpts.webhookSecret` so deliveries can be verified.
   */
  async subscribeToSelfMentions(opts: {
    url: string;
    /** Defaults to `"<bot name> mentions"`. */
    name?: string;
    /** Defaults to `'user'` (the acting user's workspace). */
    scope?: WebhookScope;
    headers?: Record<string, string>;
  }): Promise<Webhook> {
    if (this.client.authConfig.type !== 'bot') {
      throw new MacroError(
        'subscribeToSelfMentions requires bot auth — only bots have a mention webhook event (channel.bot_mentioned)',
      );
    }
    const bot = await new BotsNamespace(this.client).me();
    return Webhook.create(this.client, {
      url: opts.url,
      name: opts.name ?? `${bot.name} mentions`,
      filters: [{ events: ['channel.bot_mentioned'], ids: [`bot|${bot.id}`] }],
      scope: opts.scope,
      headers: opts.headers,
    });
  }

  /** A handle to an existing webhook by id. Details load on first access. */
  byId(id: string): Webhook {
    return Webhook.byId(this.client, id);
  }

  /**
   * The caller's webhooks across their personal and team workspaces, newest
   * first. Each returned handle already holds its record.
   */
  async list(): Promise<Webhook[]> {
    const { webhooks } = unwrap(await this.client.storage.listWebhooks());
    return webhooks.map((record) => Webhook.fromRecord(this.client, record));
  }
}
