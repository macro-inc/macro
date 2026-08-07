import type { Env } from '../../../../packages/sdk/src/config';
import { Macro } from '../../../../packages/sdk/src/macro';
import { unwrap } from '../../../../packages/sdk/src/utils';

export type ChannelConfig = {
  /** Bot API key (`mbot_...`) for the bot whose channels receive notifications. */
  botToken: string;
  /** Macro environment selected by the host. */
  env: Env;
  /** Optional storage API base URL for a custom Macro deployment. */
  storageUrl?: string;
};

/** Delivers a formatted message to every channel containing the bot. */
export type ChannelBroadcaster = (content: string) => Promise<void>;

/** Create a broadcaster backed by Macro's bot and channel webhook SDK methods. */
export function createChannelBroadcaster(
  config: ChannelConfig
): ChannelBroadcaster {
  const macro = new Macro({
    env: config.env,
    auth: { type: 'bot', token: config.botToken, scope: 'team' },
    hosts: config.storageUrl ? { storage: config.storageUrl } : undefined,
  });

  return async (content) => {
    const channels = await macro.bots.channels();
    const deliveries = await Promise.allSettled(
      channels.map(async (channel) => {
        const { message_id } = unwrap(
          await macro._client.storage.postChannelBotWebhook({
            path: { channel_id: channel.channel_id },
            body: { content },
          })
        );
        return { channelId: channel.channel_id, messageId: message_id };
      })
    );

    const failures = deliveries.filter(
      (delivery): delivery is PromiseRejectedResult =>
        delivery.status === 'rejected'
    );
    if (failures.length > 0) {
      failures.forEach((failure) => {
        console.error('Failed to post Stripe payment to a Macro channel', {
          error: failure.reason,
        });
      });
      throw new Error(
        `Failed to post to ${failures.length} of ${channels.length} Macro channels`
      );
    }

    console.log('Posted Stripe payment notification', {
      channelCount: channels.length,
    });
  };
}
