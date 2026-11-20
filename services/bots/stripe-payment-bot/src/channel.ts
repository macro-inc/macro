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

export type InvoiceDeliveries = {
  getByName(name: string): { fetch(request: Request): Promise<Response> };
};

export type ChannelBroadcaster = (
  content: string,
  invoiceId?: string
) => Promise<void>;

export function channelClient(config: ChannelConfig) {
  return new Macro({
    env: config.env,
    auth: { type: 'bot', token: config.botToken, scope: 'team' },
    hosts: config.storageUrl ? { storage: config.storageUrl } : undefined,
  });
}

export function createChannelBroadcaster(
  config: ChannelConfig,
  receipts: InvoiceDeliveries
): ChannelBroadcaster {
  const macro = channelClient(config);
  return async (content, invoiceId) => {
    const channels = await macro.bots.channels();
    const deliveries = await Promise.allSettled(
      channels.map(async (channel) => {
        if (invoiceId) {
          const id = JSON.stringify([invoiceId, channel.channel_id]);
          const result = await receipts.getByName(id).fetch(
            new Request('https://delivery.internal/', {
              method: 'POST',
              body: JSON.stringify({ channelId: channel.channel_id, content }),
            })
          );
          if (!result.ok)
            throw new Error(`Delivery returned HTTP ${result.status}`);
          return;
        }
        unwrap(
          await macro._client.storage.postChannelBotWebhook({
            path: { channel_id: channel.channel_id },
            body: { content },
          })
        );
      })
    );

    let failed = 0;
    deliveries.forEach((delivery, index) => {
      if (delivery.status === 'rejected') {
        failed++;
        console.error('Failed to post Stripe notification to a Macro channel', {
          invoiceId,
          channelId: channels[index].channel_id,
          error: delivery.reason,
        });
      }
    });
    if (failed)
      throw new Error(
        `Failed to post to ${failed} of ${channels.length} Macro channels`
      );

    console.log('Posted Stripe notification', {
      channelCount: channels.length,
    });
  };
}
