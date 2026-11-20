import type { Env } from '../../../../packages/sdk/src/config';
import { Macro } from '../../../../packages/sdk/src/macro';
import { unwrap } from '../../../../packages/sdk/src/utils';

export type ChannelBindings = {
  MACRO_ENV: Env;
  MACRO_BOT_TOKEN: string;
  MACRO_STORAGE_URL?: string;
};

export type InvoiceDeliveries = {
  getByName(name: string): { fetch(request: Request): Promise<Response> };
};

export function channelClient(env: ChannelBindings) {
  return new Macro({
    env: env.MACRO_ENV,
    auth: { type: 'bot', token: env.MACRO_BOT_TOKEN, scope: 'team' },
    hosts: env.MACRO_STORAGE_URL
      ? { storage: env.MACRO_STORAGE_URL }
      : undefined,
  });
}

export async function broadcast(
  env: ChannelBindings & { INVOICE_DELIVERIES: InvoiceDeliveries },
  content: string,
  invoiceId?: string
) {
  const macro = channelClient(env);
  const channels = await macro.bots.channels();
  const deliveries = await Promise.allSettled(
    channels.map(async (channel) => {
      if (invoiceId) {
        const id = JSON.stringify([invoiceId, channel.channel_id]);
        const result = await env.INVOICE_DELIVERIES.getByName(id).fetch(
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

  return channels.length;
}
