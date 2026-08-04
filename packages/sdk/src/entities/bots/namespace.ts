import type { Bot, BotChannel } from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * The authenticated bot's identity. Only meaningful with bot auth
 * (`auth: { type: 'bot', token }`).
 */
export class BotsNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * The authenticated bot's own record. Requires bot auth; with a user API
   * key this throws (a user token has no bot identity).
   */
  async me(): Promise<Bot> {
    if (this.client.authConfig.type !== 'bot') {
      throw new MacroError(
        'bots.me() requires bot auth — a user API key has no bot identity',
      );
    }
    return unwrap(await this.client.storage.getSelfBot());
  }

  /**
   * Channels containing the authenticated bot. Requires bot auth.
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
