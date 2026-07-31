import type {
  WebhookFilter,
  WebhookScope,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
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
