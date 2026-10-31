import { createHash, timingSafeEqual } from 'node:crypto';
import { Telemetry } from '@macro-inc/observability';
import { Hono } from 'hono';
import { toBody } from '../../../../packages/sdk/src/mentions';
import type { AlertChannel } from './channel';
import {
  alertBundlePost,
  alertStatusBundlePost,
  compactAlert,
  onCallPost,
  renderPost,
  statusChange,
  statusPost,
  statusReply,
  stillOpenReply,
} from './format';
import {
  type AlertPayload,
  type AlertStatusPayload,
  type GoAlertPayload,
  parseGoAlertPayload,
} from './goalert';
import type { AlertStore } from './store';
import { tracedChannel, tracedStore } from './traced';

const MAX_BODY_BYTES = 256 * 1024;

export type AppConfig = {
  /** Shared secret embedded in the webhook URL path. */
  webhookSecret: string;
  channel: AlertChannel;
  store: AlertStore;
};

/** What the bot did with a webhook, for logs and the response body. */
type Outcome =
  | 'posted'
  | 'still_open_replied'
  | 'status_replied'
  | 'status_posted'
  | 'bundle_posted'
  | 'notice_posted';

function sameSecret(given: string, expected: string): boolean {
  // Hashing first gives equal lengths, which timingSafeEqual requires.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

async function handleAlert(
  config: AppConfig,
  payload: AlertPayload
): Promise<Outcome> {
  const posted = await config.store.get(payload.AlertID);
  if (posted) {
    await config.channel.reply(posted.messageId, stillOpenReply(payload));
    return 'still_open_replied';
  }
  const post = compactAlert(payload);
  const messageId = await config.channel.post(renderPost(post));
  try {
    await config.store.put(payload.AlertID, { messageId, post });
  } catch {
    // The post is up and the kv.put span records the failure; later status
    // changes fall back to top-level posts.
  }
  return 'posted';
}

async function handleAlertStatus(
  config: AppConfig,
  payload: AlertStatusPayload
): Promise<Outcome> {
  const posted = await config.store.get(payload.AlertID);
  if (!posted) {
    await config.channel.post(statusPost(payload));
    return 'status_posted';
  }
  const { channel } = config;
  const change = statusChange(payload.LogEntry);
  const updates = [
    channel.reply(posted.messageId, statusReply(payload.LogEntry)),
  ];
  if (change === 'acknowledged') {
    updates.push(channel.react(posted.messageId, '👀'));
  } else if (change === 'closed') {
    updates.push(
      channel.react(posted.messageId, '✅'),
      channel.edit(posted.messageId, renderPost(posted.post, true))
    );
  }
  await Promise.all(updates);
  return 'status_replied';
}

async function handle(
  config: AppConfig,
  payload: GoAlertPayload
): Promise<Outcome> {
  const { channel } = config;
  if (payload.Type === 'Alert') return handleAlert(config, payload);
  if (payload.Type === 'AlertStatus') return handleAlertStatus(config, payload);
  if (payload.Type === 'AlertBundle') {
    await channel.post(alertBundlePost(payload));
    return 'bundle_posted';
  }
  if (payload.Type === 'AlertStatusBundle') {
    await channel.post(alertStatusBundlePost(payload));
    return 'bundle_posted';
  }
  if (payload.Type === 'ScheduleOnCallUsers') {
    await channel.post(onCallPost(payload));
    return 'notice_posted';
  }
  if (payload.Type === 'Verification') {
    await channel.post(toBody(`GoAlert verification code: ${payload.Code}`));
    return 'notice_posted';
  }
  await channel.post(toBody('GoAlert test message for the Macro Alerts bot.'));
  return 'notice_posted';
}

/**
 * GoAlert → Macro Alerts channel bot.
 *
 * GoAlert's outgoing webhooks cannot set headers, so the URL carries a shared
 * secret: POST /goalert/{WEBHOOK_SECRET}. GoAlert abandons a webhook after
 * about three seconds, so each request does at most a store read, the channel
 * calls (in parallel), and a store write.
 *
 * Unrecognized payloads are acknowledged and ignored; a failed channel call
 * returns 502 so it shows in GoAlert's logs.
 */
export function createApp(config: AppConfig) {
  const app = new Hono();
  const tracedConfig: AppConfig = {
    ...config,
    channel: tracedChannel(config.channel),
    store: tracedStore(config.store),
  };

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/goalert/:secret', async (c) => {
    if (!sameSecret(c.req.param('secret'), config.webhookSecret)) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return c.json({ error: 'body too large' }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const payload = parseGoAlertPayload(body);
    if (!payload) {
      console.warn('Ignoring unrecognized GoAlert webhook payload');
      return c.json({ ok: true, ignored: true });
    }

    return Telemetry.span('goalert_bot.webhook', async (span) => {
      span.setAttr('goalert.payload_type', payload.Type);
      if (payload.Type === 'Alert' || payload.Type === 'AlertStatus') {
        span.setAttr('goalert.alert_id', payload.AlertID);
      }
      if (
        payload.Type === 'Alert' ||
        payload.Type === 'AlertStatus' ||
        payload.Type === 'AlertBundle' ||
        payload.Type === 'AlertStatusBundle'
      ) {
        span.setAttr('goalert.service_name', payload.ServiceName);
      }
      try {
        const outcome = await handle(tracedConfig, payload);
        span.setAttr('goalert.outcome', outcome);
        return c.json({ ok: true, outcome });
      } catch (error) {
        span.setAttr('goalert.outcome', 'failed');
        span.error(error);
        return c.json({ error: 'failed to deliver message' }, 502);
      }
    });
  });

  return app;
}
