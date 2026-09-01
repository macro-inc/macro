import type {
  PatchWebhookRequest,
  ValidateWebhookResponse,
  WebhookFilter,
  Webhook as WebhookRecord,
  WebhookScope,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/**
 * A webhook registration: an HTTPS endpoint Macro delivers signed entity
 * events to.
 *
 * A free-to-construct `(client, id)` handle like any other entity: the detail
 * record loads lazily from the webhook GET endpoint on first field access and
 * is dropped after any mutation. {@link WebhooksNamespace.list} enumerates the
 * caller's webhooks across their personal and team workspaces.
 *
 * The signing secret is only ever returned once, from {@link create}; it's
 * exposed there as {@link Webhook.signingSecret}. Save it — patches, gets,
 * and `byId` handles never carry it again — and pass it to
 * `MacroOpts.webhookSecret` so `macro.events.webhook()` can verify
 * deliveries. Live SSE via `macro.events.listen()` does not use a
 * persisted webhook or signing secret.
 */
export class Webhook extends MacroEntity<WebhookRecord> {
  /**
   * The signing secret used to verify deliveries, present only on the handle
   * returned by {@link create}. `undefined` for `byId` and listed handles.
   */
  readonly signingSecret?: string;

  private constructor(
    client: MacroClient,
    id: string,
    seed?: WebhookRecord,
    signingSecret?: string,
  ) {
    super(client, id, seed);
    this.signingSecret = signingSecret;
  }

  protected async fetch(): Promise<WebhookRecord> {
    return unwrap(
      await this.client.storage.getWebhook({
        path: { webhook_id: this.id },
      }),
    );
  }

  /** Register a webhook. */
  static async create(
    client: MacroClient,
    opts: {
      url: string;
      namespace: string;
      name: string;
      filters: WebhookFilter[];
      scope?: WebhookScope;
      headers?: Record<string, string>;
    },
  ): Promise<Webhook> {
    const record = unwrap(
      await client.storage.createWebhook({
        body: {
          endpoint_url: opts.url,
          namespace: opts.namespace,
          name: opts.name,
          filters: opts.filters,
          scope: opts.scope ?? 'user',
          ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
        },
      }),
    );
    return new Webhook(client, record.id, record, record.signing_secret);
  }

  /** A handle to a webhook by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Webhook {
    return new Webhook(client, id);
  }

  /** Wrap an already-loaded record. */
  static fromRecord(client: MacroClient, record: WebhookRecord): Webhook {
    return new Webhook(client, record.id, record);
  }

  /** The webhook's display name. */
  readonly name = this.field('name');

  /**
   * The caller-chosen namespace, unique among the owning workspace's webhooks.
   * Fixed at creation time; it cannot be patched.
   */
  readonly namespace = this.field('namespace');

  /** The HTTPS endpoint URL deliveries are sent to. */
  readonly endpointUrl = this.field('endpoint_url');

  /** The webhook's lifecycle status. */
  readonly status = this.field('status');

  /** Whether the current endpoint configuration has passed validation. */
  readonly isValid = this.field('is_valid');

  /** The event/entity-id filters that gate deliveries. */
  readonly filters = this.field('filters');

  /** When the webhook was created. */
  readonly createdAt = this.field('created_at');

  /** The owning workspace id: the creator's user id for a personal webhook, or a team id for a team webhook. */
  readonly workspaceId = this.field('workspace_id');

  /** The user who registered this webhook. */
  readonly createdBy = this.mappedField('created_by_user_id', (id) =>
    User.byId(this.client, id),
  );

  /**
   * Whether this webhook is owned by the caller personally (`user`) or by
   * their team (`team`). Derived from ownership: a personal webhook's owning
   * workspace is the creator's own user id, whereas a team webhook's workspace
   * is a distinct team id.
   */
  async scope(): Promise<WebhookScope> {
    const record = await this.detail.get();
    return record.workspace_id === record.created_by_user_id ? 'user' : 'team';
  }

  /** Update the webhook. */
  public async update(body: PatchWebhookRequest): Promise<void> {
    await this.mutate((client) =>
      client.storage.patchWebhook({
        path: { webhook_id: this.id },
        body,
      }),
    );
  }

  /** Rename the webhook. */
  async rename(name: string): Promise<void> {
    await this.update({ name });
  }

  /** Point the webhook at a new HTTPS endpoint URL. */
  async setUrl(url: string): Promise<void> {
    await this.update({ endpoint_url: url });
  }

  /** Replace the webhook's delivery filters (must be non-empty). */
  async setFilters(filters: WebhookFilter[]): Promise<void> {
    await this.update({ filters });
  }

  /** Pause deliveries. */
  async pause(): Promise<void> {
    await this.update({ status: 'paused' });
  }

  /** Resume deliveries. */
  async resume(): Promise<void> {
    await this.update({ status: 'active' });
  }

  /** Delete the webhook. */
  async delete(): Promise<void> {
    await this.mutate((client) =>
      client.storage.deleteWebhook({
        path: { webhook_id: this.id },
      }),
    );
  }

  /**
   * Send a signed validation test delivery to the endpoint and report whether
   * it was accepted. Drops the cached detail so a subsequent {@link isValid}
   * read reflects the new validation state.
   */
  async validate(): Promise<ValidateWebhookResponse> {
    return this.mutate((client) =>
      client.storage.validateWebhook({
        path: { webhook_id: this.id },
      }),
    );
  }
}
