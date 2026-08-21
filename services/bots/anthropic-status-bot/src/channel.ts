import type { Env } from '../../../../packages/sdk/src/config';
import { Macro } from '../../../../packages/sdk/src/macro';
import { unwrap } from '../../../../packages/sdk/src/utils';

export type ChannelConfig = {
  /** UUID of the channel the bot posts to. */
  channelId: string;
  /** Bot API key (mbot_...), sent as x-macro-bot-token. */
  botToken: string;
  /** Macro environment. Defaults to prod. */
  env?: Env;
};

/** Posts a message to the configured channel. Throws on failure. */
export type ChannelPoster = (content: string) => Promise<void>;

/**
 * Post channel messages via the Macro SDK's channel bot webhook.
 *
 * Uses bot auth (x-macro-bot-token, user scope) — the preferred auth for
 * POST /channels/{channel_id}/webhook. The bot must be a participant of the
 * channel; the user scope requires no acting user for this endpoint.
 */
export function createChannelPoster(config: ChannelConfig): ChannelPoster {
  const macro = new Macro({
    env: config.env ?? 'prod',
    auth: { type: 'bot', token: config.botToken, scope: 'user' },
  });

  return async (content) => {
    const { message_id } = unwrap(
      await macro._client.storage.postChannelBotWebhook({
        path: { channel_id: config.channelId },
        body: { content },
      })
    );
    console.log('Posted channel message', { message_id });
  };
}
