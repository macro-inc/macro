import { Hono } from 'hono';
import type { ChannelPoster } from './channel';
import { formatComponentMessage, formatIncidentMessage } from './format';
import { parseWebhookPayload } from './statuspage';

export type AppConfig = {
  /** Shared secret embedded in the webhook URL path. */
  webhookSecret: string;
  /** Delivers a formatted message to the Macro channel. */
  postToChannel: ChannelPoster;
};

/**
 * Anthropic (Claude) status page → Macro channel bot.
 *
 * status.claude.com is powered by Atlassian Statuspage, which supports
 * webhook subscriptions but provides no request signing, so the webhook URL
 * carries a shared secret: POST /webhook/{WEBHOOK_SECRET}.
 *
 * Statuspage requires a 2xx response within 30s; unrecognized payloads are
 * acknowledged and ignored rather than retried.
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
      console.warn('Ignoring unrecognized statuspage webhook payload');
      return c.json({ ok: true, ignored: true });
    }

    const content =
      parsed.kind === 'incident'
        ? formatIncidentMessage(parsed.payload)
        : formatComponentMessage(parsed.payload);

    try {
      await config.postToChannel(content);
    } catch (err) {
      console.error('Failed to post status update to channel', err);
      return c.json({ error: 'failed to deliver message' }, 502);
    }

    console.log('Posted status update to channel', { kind: parsed.kind });
    return c.json({ ok: true });
  });

  return app;
}
