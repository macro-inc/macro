import type { BotToken as BotTokenRecord } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Bot } from './bot';

/** A bot bearer token's metadata. The secret is returned only by `Bot.createToken`. */
export class BotToken extends MacroEntity<BotTokenRecord> {
  private constructor(
    client: MacroClient,
    /** The bot this token authenticates. */
    readonly bot: Bot,
    id: string,
    seed?: BotTokenRecord,
  ) {
    super(client, id, seed);
  }

  /** A handle to one of a bot's tokens by id. */
  static byId(client: MacroClient, bot: Bot, id: string): BotToken {
    return new BotToken(client, bot, id);
  }

  /** Seed from a listed or created token. */
  static from(client: MacroClient, bot: Bot, record: BotTokenRecord): BotToken {
    return new BotToken(client, bot, record.id, record);
  }

  protected async fetch(): Promise<BotTokenRecord> {
    const record = unwrap(
      await this.client.storage.listBotTokens({
        path: { bot_id: this.bot.id },
      }),
    ).find((token) => token.id === this.id);
    if (!record) throw new MacroNotFoundError(`bot token ${this.id} not found`);
    return record;
  }

  /** The first characters of the secret, for telling tokens apart. */
  readonly prefix = this.field('token_prefix');

  /** Where the token is used, such as `github-webhook`. */
  readonly label = this.field('label');

  /** Last time the token authenticated a request. */
  readonly lastUsedAt = this.field('last_used_at');

  /** Scheduled expiry. */
  readonly expiresAt = this.field('expires_at');

  /** When the token was revoked. */
  readonly revokedAt = this.field('revoked_at');

  /** Creation time. */
  readonly createdAt = this.field('created_at');

  /**
   * Revoke the token; requests using it fail from now on.
   *
   * @destructive
   * @idempotent
   */
  async revoke(): Promise<void> {
    await this.mutate((c) =>
      c.storage.revokeBotToken({
        path: { bot_id: this.bot.id, token_id: this.id },
      }),
    );
  }

  override toJSON(): { id: string; botId: string; detail?: BotTokenRecord } {
    return { ...super.toJSON(), botId: this.bot.id };
  }
}
