import type {
  Bot as BotRecord,
  CreateBotRequest,
  PatchBotRequest,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { MacroEntity } from '../entity';
import { Team } from '../teams/team';
import { User } from '../users/user';
import { BotToken } from './token';

/** Settings for a new bot. */
export type CreateBotOptions = {
  /** Display name. */
  name: string;
  /** Stable mention handle: lowercase ASCII letters, digits, `-` and `_`, at most 64 characters. */
  handle: string;
  /** Short description of what the bot does. */
  description?: string;
  /** Profile picture URL, such as a Macro static-file URL. */
  avatarUrl?: string;
  /** Owning team; omit for a bot owned by the caller. Requires team admin or owner. */
  team?: Team;
  /** Whether mentioning the bot opens a coding-agent session. Defaults to false. */
  hasAgent?: boolean;
};

/** Profile changes for a bot; omitted fields keep their value. */
export type UpdateBotOptions = {
  /** New display name. */
  name?: string;
  /** New stable handle. Integrations and mentions may rely on the old one. */
  handle?: string;
  /** New description; an empty string clears it. */
  description?: string;
  /** New profile picture URL; an empty string clears it. */
  avatarUrl?: string;
  /** Whether mentioning the bot opens a coding-agent session. */
  hasAgent?: boolean;
};

/** A bot channel webhook: POST `{ content }` to `url` to post as the bot. */
export type BotWebhook = {
  /** Channel the webhook posts into. */
  channel: Channel;
  /** Public URL to POST to. */
  url: string;
};

/** Who owns a bot. */
export type BotOwner =
  | { type: 'user'; user: User }
  | { type: 'team'; team: Team };

/** A user- or team-owned bot: an identity that posts to channels through webhooks or the SDK. */
export class Bot extends MacroEntity<BotRecord> {
  /** A handle to a bot by id. */
  static byId(client: MacroClient, id: string): Bot {
    return new Bot(client, id);
  }

  /** Seed from a listed or created bot. */
  static from(client: MacroClient, record: BotRecord): Bot {
    return new Bot(client, record.id, record);
  }

  /** Create a bot owned by the caller or by a team. */
  static async create(
    client: MacroClient,
    options: CreateBotOptions,
  ): Promise<Bot> {
    const body: CreateBotRequest = {
      name: options.name,
      handle: options.handle,
      description: options.description,
      avatar_url: options.avatarUrl,
      team_id: options.team?.id,
      has_agent: options.hasAgent,
    };
    return Bot.from(client, unwrap(await client.storage.createBot({ body })));
  }

  /** The bots the caller can manage: their own and their teams'. */
  static async list(client: MacroClient): Promise<Bot[]> {
    return unwrap(await client.storage.listBots()).map((record) =>
      Bot.from(client, record),
    );
  }

  protected async fetch(): Promise<BotRecord> {
    return unwrap(
      await this.client.storage.getBot({ path: { bot_id: this.id } }),
    );
  }

  /** Display name. */
  readonly name = this.field('name');

  /** Stable mention handle, without the `@`. */
  readonly handle = this.field('handle');

  /** Short description. */
  readonly description = this.field('description');

  /** Profile picture URL. */
  readonly avatarUrl = this.field('avatar_url');

  /** Whether mentioning the bot opens a coding-agent session. */
  readonly hasAgent = this.field('has_agent');

  /** Creation time. */
  readonly createdAt = this.field('created_at');

  /** Last profile change. */
  readonly updatedAt = this.field('updated_at');

  /** The owning user or team. */
  readonly owner = this.mappedField('owner', (owner): BotOwner | undefined => {
    if (!owner) return undefined;
    return owner.type === 'user'
      ? { type: 'user', user: User.byId(this.client, owner.user_id) }
      : { type: 'team', team: Team.byId(this.client, owner.team_id) };
  });

  /**
   * Change the bot's profile; pass only the fields that should change.
   *
   * @write
   * @idempotent
   */
  async update(changes: UpdateBotOptions): Promise<void> {
    const body: PatchBotRequest = {
      name: changes.name,
      handle: changes.handle,
      description: changes.description,
      avatar_url: changes.avatarUrl,
      has_agent: changes.hasAgent,
    };
    await this.mutate((c) =>
      c.storage.patchBot({ path: { bot_id: this.id }, body }),
    );
  }

  /**
   * Delete the bot. Its tokens stop working and it leaves every channel.
   *
   * @destructive
   * @idempotent
   */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteBot({ path: { bot_id: this.id } }),
    );
  }

  /**
   * Channels the bot can post to.
   *
   * @readonly
   */
  async channels(): Promise<Channel[]> {
    return unwrap(
      await this.client.storage.listBotChannels({
        path: { bot_id: this.id },
      }),
    ).map((channel) => Channel.byId(this.client, channel.channel_id));
  }

  /**
   * One webhook per channel the bot can post to. POST JSON `{ content }` with
   * a token from {@link createToken} in the `x-macro-bot-token` header and
   * `x-macro-bot-scope: user`. Empty until {@link grantChannel}.
   *
   * @readonly
   */
  async webhooks(): Promise<BotWebhook[]> {
    const base = this.client.hosts.storage.replace(/\/+$/, '');
    return (await this.channels()).map((channel) => ({
      channel,
      url: `${base}/channels/${channel.id}/webhook`,
    }));
  }

  /**
   * Let the bot post to a channel. The caller must be a member of it and manage the bot.
   *
   * @write
   * @idempotent
   */
  async grantChannel(channel: Channel): Promise<void> {
    unwrap(
      await this.client.storage.addChannelBot({
        path: { channel_id: channel.id },
        body: { bot_id: this.id },
      }),
    );
  }

  /**
   * Remove the bot from a channel. Works after the caller has left the channel.
   *
   * @destructive
   * @idempotent
   */
  async revokeChannel(channel: Channel): Promise<void> {
    unwrap(
      await this.client.storage.removeBotFromChannelByBot({
        path: { bot_id: this.id, channel_id: channel.id },
      }),
    );
  }

  /**
   * The bot's tokens, including revoked and expired ones. Secrets are never returned.
   *
   * @readonly
   */
  async tokens(): Promise<BotToken[]> {
    return unwrap(
      await this.client.storage.listBotTokens({ path: { bot_id: this.id } }),
    ).map((record) => BotToken.from(this.client, this, record));
  }

  /**
   * Mint a bearer token for the bot's webhooks and API. The secret is returned
   * once and cannot be read again; never write it into chat, documents or
   * results. To hand a user a token, have them mint it in bot settings.
   *
   * @write
   */
  async createToken(
    options: { label?: string; expiresAt?: Date } = {},
  ): Promise<{ token: BotToken; secret: string }> {
    const response = unwrap(
      await this.client.storage.createBotToken({
        path: { bot_id: this.id },
        body: {
          label: options.label,
          expires_at: options.expiresAt?.toISOString(),
        },
      }),
    );
    return {
      token: BotToken.from(this.client, this, response.token),
      secret: response.bearer_token,
    };
  }
}
