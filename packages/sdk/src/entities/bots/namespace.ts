import type {
  BotChannel,
  Bot as BotRecord,
} from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Bot, type CreateBotOptions } from './bot';

/**
 * Bots the user manages — create, list, configure, delete, channel access,
 * webhooks and tokens — and, with bot auth (`auth: { type: 'bot', token }`),
 * the authenticated bot's own identity.
 *
 * @routing Use when inspecting or managing bots and their channel access; not an agent's instructions, which are agents.
 */
export class BotsNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a bot by id. */
  byId(id: string): Bot {
    return Bot.byId(this.client, id);
  }

  /**
   * The bots the user can manage: their own and their teams'.
   *
   * @readonly
   */
  async list(): Promise<Bot[]> {
    return Bot.list(this.client);
  }

  /**
   * Create a bot. It can post nowhere until `bot.grantChannel(channel)`; then
   * `bot.webhooks()` and `bot.createToken()` give an integration what it needs.
   *
   * @write
   */
  async create(options: CreateBotOptions): Promise<Bot> {
    return Bot.create(this.client, options);
  }

  /**
   * The authenticated bot's own record. Requires bot auth; with a user API
   * key this throws (a user token has no bot identity).
   *
   * @readonly
   */
  async me(): Promise<BotRecord> {
    if (this.client.authConfig.type !== 'bot') {
      throw new MacroError(
        'bots.me() requires bot auth — a user API key has no bot identity',
      );
    }
    return unwrap(await this.client.storage.getSelfBot());
  }

  /**
   * Channels containing the authenticated bot. Requires bot auth.
   *
   * @readonly
   */
  async channels(): Promise<BotChannel[]> {
    if (this.client.authConfig.type !== 'bot') {
      throw new MacroError(
        'bots.channels() requires bot auth — a user API key has no bot identity',
      );
    }
    const bot = await this.me();
    return unwrap(
      await this.client.storage.listBotChannels({
        path: { bot_id: bot.id },
      }),
    );
  }

  /**
   * The authenticated bot's canonical principal id (`bot|<uuid>`) — the form
   * used for bot mentions, senders, and webhook `ids` filters. Cached on the
   * client; see {@link MacroClient.myPrincipalId}.
   *
   * @readonly
   */
  async myPrincipalId(): Promise<string> {
    if (this.client.authConfig.type !== 'bot') {
      throw new MacroError(
        'bots.myPrincipalId() requires bot auth — a user API key has no bot identity',
      );
    }
    return this.client.myPrincipalId();
  }
}
