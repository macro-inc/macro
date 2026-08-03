import type { Bot } from '../../../generated/storage/types.gen';
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
    return unwrap(
      await this.client.storage.getSelfBot({
        headers: { 'x-macro-bot-scope': 'user' },
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
