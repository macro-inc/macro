import { describe, expect, test } from 'bun:test';
import type { RichMessage } from '../../../../packages/sdk/src/mentions';
import type { AlertChannel } from '../src/channel';
import { createApp } from '../src/index';
import { type AlertStore, createMemoryAlertStore } from '../src/store';

type ChannelCall =
  | { kind: 'post'; body: RichMessage }
  | { kind: 'reply'; messageId: string; body: RichMessage }
  | { kind: 'react'; messageId: string; emoji: string }
  | { kind: 'edit'; messageId: string; body: RichMessage };

/** Records every channel call; posts get ids `message-1`, `message-2`, … */
function fakeChannel(): AlertChannel & { calls: ChannelCall[] } {
  const calls: ChannelCall[] = [];
  return {
    calls,
    post: async (body) => {
      calls.push({ kind: 'post', body });
      return `message-${calls.filter((call) => call.kind === 'post').length}`;
    },
    reply: async (messageId, body) => {
      calls.push({ kind: 'reply', messageId, body });
    },
    react: async (messageId, emoji) => {
      calls.push({ kind: 'react', messageId, emoji });
    },
    edit: async (messageId, body) => {
      calls.push({ kind: 'edit', messageId, body });
    },
  };
}

function makeApp(channel: AlertChannel, store: AlertStore) {
  return createApp({ webhookSecret: 'test-secret', channel, store });
}

function postWebhook(
  app: ReturnType<typeof makeApp>,
  body: unknown,
  secret = 'test-secret'
) {
  return app.request(`/goalert/${secret}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const HERE_TAG = '<m-group-mention>{"groupAlias":"here"}</m-group-mention>';

const PAGE_ALERT = {
  AppName: 'GoAlert',
  Type: 'Alert',
  AlertID: 127,
  Summary: 'macro-db-prod CPU high',
  Details: '| severity | critical |\n| description | CPU at 92%. |',
  ServiceID: 'b4b2c1a6-0000-4000-8000-000000000001',
  ServiceName: 'Grafana critical',
  Meta: {},
  GoAlertURL: 'https://oncall.macro-internal.com/alerts/127',
};

const PAGE_POST = {
  page: true,
  headline: '🚨 **PAGE** · **macro-db-prod CPU high**',
  lines: [
    '🔴 critical',
    'CPU at 92%.',
    '[Acknowledge](https://oncall.macro-internal.com/alerts/127)',
  ],
};

function statusFor(alertId: number, logEntry: string) {
  return {
    AppName: 'GoAlert',
    Type: 'AlertStatus',
    AlertID: alertId,
    Summary: 'macro-db-prod CPU high',
    ServiceID: 'b4b2c1a6-0000-4000-8000-000000000001',
    ServiceName: 'Grafana critical',
    LogEntry: logEntry,
    GoAlertURL: `https://oncall.macro-internal.com/alerts/${alertId}`,
  };
}

describe('goalert-bot webhook', () => {
  test('health check', async () => {
    const app = makeApp(fakeChannel(), createMemoryAlertStore());
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('rejects a wrong secret without posting', async () => {
    const channel = fakeChannel();
    const app = makeApp(channel, createMemoryAlertStore());
    const res = await postWebhook(app, PAGE_ALERT, 'wrong-secret');
    expect(res.status).toBe(401);
    expect(channel.calls).toEqual([]);
  });

  test('rejects invalid JSON', async () => {
    const channel = fakeChannel();
    const app = makeApp(channel, createMemoryAlertStore());
    const res = await postWebhook(app, 'not json{');
    expect(res.status).toBe(400);
    expect(channel.calls).toEqual([]);
  });

  test('acknowledges and ignores unrecognized payloads', async () => {
    const channel = fakeChannel();
    const app = makeApp(channel, createMemoryAlertStore());
    const res = await postWebhook(app, { Type: 'SomethingNew' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(channel.calls).toEqual([]);
  });

  test('new alert is posted and stored', async () => {
    const channel = fakeChannel();
    const store = createMemoryAlertStore();
    const res = await postWebhook(makeApp(channel, store), PAGE_ALERT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'posted' });
    expect(channel.calls).toEqual([
      {
        kind: 'post',
        body: {
          content: `🚨 **PAGE** · **macro-db-prod CPU high** ${HERE_TAG}\n🔴 critical\nCPU at 92%.\n[Acknowledge](https://oncall.macro-internal.com/alerts/127)`,
          mentions: [{ entity_type: 'group', entity_id: 'here' }],
        },
      },
    ]);
    expect(await store.get(127)).toEqual({
      messageId: 'message-1',
      post: PAGE_POST,
    });
  });

  test('repeated alert replies in its thread', async () => {
    const channel = fakeChannel();
    const store = createMemoryAlertStore();
    await store.put(127, { messageId: 'message-9', post: PAGE_POST });
    const res = await postWebhook(makeApp(channel, store), PAGE_ALERT);
    expect(await res.json()).toEqual({
      ok: true,
      outcome: 'still_open_replied',
    });
    expect(channel.calls).toEqual([
      {
        kind: 'reply',
        messageId: 'message-9',
        body: {
          content: `⏰ Still open · [Acknowledge](https://oncall.macro-internal.com/alerts/127) ${HERE_TAG}`,
          mentions: [{ entity_type: 'group', entity_id: 'here' }],
        },
      },
    ]);
  });

  test('acknowledgement replies and reacts', async () => {
    const channel = fakeChannel();
    const store = createMemoryAlertStore();
    await store.put(127, { messageId: 'message-9', post: PAGE_POST });
    const res = await postWebhook(
      makeApp(channel, store),
      statusFor(127, 'Acknowledged by Sam')
    );
    expect(await res.json()).toEqual({ ok: true, outcome: 'status_replied' });
    expect(channel.calls).toEqual([
      {
        kind: 'reply',
        messageId: 'message-9',
        body: { content: '👀 Acknowledged by Sam', mentions: [] },
      },
      { kind: 'react', messageId: 'message-9', emoji: '👀' },
    ]);
  });

  test('close replies, reacts, and marks the post resolved', async () => {
    const channel = fakeChannel();
    const store = createMemoryAlertStore();
    await store.put(127, { messageId: 'message-9', post: PAGE_POST });
    const res = await postWebhook(
      makeApp(channel, store),
      statusFor(127, 'Closed by Datadog')
    );
    expect(await res.json()).toEqual({ ok: true, outcome: 'status_replied' });
    expect(channel.calls).toEqual([
      {
        kind: 'reply',
        messageId: 'message-9',
        body: { content: '✅ Closed by Datadog', mentions: [] },
      },
      { kind: 'react', messageId: 'message-9', emoji: '✅' },
      {
        kind: 'edit',
        messageId: 'message-9',
        body: {
          content:
            '✅ Resolved · 🚨 **PAGE** · **macro-db-prod CPU high**\n🔴 critical\nCPU at 92%.\n[Acknowledge](https://oncall.macro-internal.com/alerts/127)',
          mentions: [],
        },
      },
    ]);
  });

  test('status change for an unknown alert is posted top-level', async () => {
    const channel = fakeChannel();
    const res = await postWebhook(
      makeApp(channel, createMemoryAlertStore()),
      statusFor(48, 'Closed by Datadog')
    );
    expect(await res.json()).toEqual({ ok: true, outcome: 'status_posted' });
    expect(channel.calls).toEqual([
      {
        kind: 'post',
        body: {
          content:
            'Closed by Datadog · macro-db-prod CPU high · [Open](https://oncall.macro-internal.com/alerts/48)',
          mentions: [],
        },
      },
    ]);
  });

  test('bundle is one top-level line', async () => {
    const channel = fakeChannel();
    const res = await postWebhook(makeApp(channel, createMemoryAlertStore()), {
      AppName: 'GoAlert',
      Type: 'AlertBundle',
      ServiceID: 'b4b2c1a6-0000-4000-8000-000000000002',
      ServiceName: 'Notify',
      Count: 5,
      GoAlertURL: 'https://oncall.macro-internal.com/services/notify/alerts',
    });
    expect(await res.json()).toEqual({ ok: true, outcome: 'bundle_posted' });
    expect(channel.calls).toEqual([
      {
        kind: 'post',
        body: {
          content:
            '🔔 · 5 alerts on Notify · [Acknowledge](https://oncall.macro-internal.com/services/notify/alerts)',
          mentions: [],
        },
      },
    ]);
  });

  test('a failed channel call returns 502', async () => {
    const channel = fakeChannel();
    channel.post = async () => {
      throw new Error('channel unavailable');
    };
    const store = createMemoryAlertStore();
    const res = await postWebhook(makeApp(channel, store), PAGE_ALERT);
    expect(res.status).toBe(502);
    expect(await store.get(127)).toBeUndefined();
  });
});
