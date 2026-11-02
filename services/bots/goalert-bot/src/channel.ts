import type { Env } from '../../../../packages/sdk/src/config';
import { Macro } from '../../../../packages/sdk/src/macro';
import type { RichMessage } from '../../../../packages/sdk/src/mentions';

export type ChannelConfig = {
  /** UUID of the channel the bot posts to. */
  channelId: string;
  /** Bot API key (mbot_...), sent as x-macro-bot-token. */
  botToken: string;
  /** The bot owner's user id (`macro|<email>`); the bot acts as this user. */
  actingUserId: string;
  /** Macro environment. Defaults to prod. */
  env?: Env;
};

/** The channel operations the bot needs. Every method throws on failure. */
export type AlertChannel = {
  /** Post a top-level message and return its id. */
  post(body: RichMessage): Promise<string>;
  /** Reply in the thread rooted at `messageId`. */
  reply(messageId: string, body: RichMessage): Promise<void>;
  react(messageId: string, emoji: string): Promise<void>;
  edit(messageId: string, body: RichMessage): Promise<void>;
};

/**
 * The alerts channel through the Macro SDK.
 *
 * The bot is user-owned and acts as its owner (`x-macro-bot-for-macro-user-id`,
 * user scope), which routes posts through the entity message API: threads,
 * mentions, edits and reactions. Messages show the bot as sender. A team-owned
 * bot would drop `requestedAs` and use the default team scope instead.
 */
export function createAlertChannel(config: ChannelConfig): AlertChannel {
  const bot = new Macro({
    env: config.env ?? 'prod',
    auth: { type: 'bot', token: config.botToken, scope: 'user' },
  });
  const macro = bot.requestedAs(bot.users.byId(config.actingUserId));
  const channel = macro.channels.byId(config.channelId);

  return {
    post: async (body) => (await channel.send(body)).id,
    reply: async (messageId, body) => {
      await channel.message(messageId).reply(body);
    },
    react: async (messageId, emoji) => {
      await channel.message(messageId).react(emoji);
    },
    edit: async (messageId, body) => {
      await channel.message(messageId).edit(body);
    },
  };
}
