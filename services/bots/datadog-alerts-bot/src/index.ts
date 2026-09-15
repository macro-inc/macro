import { Hono } from 'hono';
import type { ChannelPoster } from './channel';
import { parseWebhookPayload } from './datadog';
import { formatAlertMessage } from './format';

export type AppConfig = {
  /** Shared secret embedded in the webhook URL path. */
  webhookSecret: string;
  /** Delivers a formatted message to the Macro channel. */
  postToChannel: ChannelPoster;
};

/**
 * Datadog monitor alerts → Macro channel bot.
 *
 * Datadog's webhook integration POSTs a user-defined JSON payload when a
 * monitor mentions `@webhook-<name>`. Webhooks carry no request signing, so
 * the URL carries a shared secret: POST /webhook/{WEBHOOK_SECRET}.
 *
 * Datadog retries failed deliveries; unrecognized payloads are acknowledged
 * and ignored rather than retried.
 */
export function createApp(config: AppConfig) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/webhook/:secret', async (c) => {
    if (c.req.param('secret') !== config.webhookSecret) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const parsed = parseWebhookPayload(body);
    if (!parsed.ok) {
      console.warn('Ignoring unrecognized datadog webhook payload');
      return c.json({ ok: true, ignored: true });
    }

    const content = formatAlertMessage(parsed.payload);

    try {
      await config.postToChannel(content);
    } catch (err) {
      console.error('Failed to post alert to channel', err);
      return c.json({ error: 'failed to deliver message' }, 502);
    }

    console.log('Posted alert to channel', {
      transition: parsed.payload.transition,
    });
    return c.json({ ok: true });
  });

  return app;
}
