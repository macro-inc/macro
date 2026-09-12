import { describe, expect, mock, test } from 'bun:test';
import { createApp } from '../src/index';

// Payloads as rendered by the webhook JSON template configured in Datadog
// (Integrations → Webhooks → macro-ai-alert-bot); see src/datadog.ts.
const TRIGGERED_PAYLOAD = {
  title: '[Triggered] [PROD] AI Not Responding — AI stream error spike',
  body: 'AI stream errors are spiking above the expected baseline for document-cognition-service.\n\nCheck the AI stream error logs and provider status.',
  transition: 'Triggered',
  link: 'https://us5.datadoghq.com/monitors/12345?to_ts=1787168791000',
  priority: 'P2',
  tags: 'monitor,service:document-cognition-service',
  date: '1787168791000',
};

const RECOVERED_PAYLOAD = {
  title: '[Recovered] [PROD] AI Not Responding — AI stream error spike',
  body: 'AI stream error volume returned to the expected baseline.',
  transition: 'Recovered',
  link: 'https://us5.datadoghq.com/monitors/12345',
  priority: 'P2',
  tags: 'monitor,service:document-cognition-service',
  date: '1787172391000',
};

function makeApp(postToChannel: (content: string) => Promise<void>) {
  return createApp({ webhookSecret: 'test-secret', postToChannel });
}

function postWebhook(
  app: ReturnType<typeof makeApp>,
  body: unknown,
  secret = 'test-secret'
) {
  return app.request(`/webhook/${secret}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('datadog-alerts-bot webhook', () => {
  test('health check', async () => {
    const app = makeApp(mock(async () => {}));
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('rejects wrong secret without posting', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);
    const res = await postWebhook(app, TRIGGERED_PAYLOAD, 'wrong-secret');
    expect(res.status).toBe(401);
    expect(poster).not.toHaveBeenCalled();
  });

  test('rejects invalid JSON', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);
    const res = await postWebhook(app, 'not json{');
    expect(res.status).toBe(400);
    expect(poster).not.toHaveBeenCalled();
  });

  test('acknowledges and ignores unrecognized payloads', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);
    const res = await postWebhook(app, { hello: 'world' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(poster).not.toHaveBeenCalled();
  });

  test('formats triggered alerts and posts them to the channel', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);

    const res = await postWebhook(app, TRIGGERED_PAYLOAD);
    expect(res.status).toBe(200);

    expect(poster).toHaveBeenCalledTimes(1);
    const [content] = poster.mock.calls[0] as unknown as [string];
    expect(content).toContain(
      '🚨 [Datadog] [Triggered] [PROD] AI Not Responding'
    );
    expect(content).toContain('AI stream errors are spiking');
    expect(content).toContain('Priority: P2');
    expect(content).toContain(
      'Tags: monitor,service:document-cognition-service'
    );
    expect(content).toContain('https://us5.datadoghq.com/monitors/12345');
  });

  test('formats recovery alerts with the recovered emoji', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);

    const res = await postWebhook(app, RECOVERED_PAYLOAD);
    expect(res.status).toBe(200);

    const [content] = poster.mock.calls[0] as unknown as [string];
    expect(content).toContain(
      '✅ [Datadog] [Recovered] [PROD] AI Not Responding'
    );
  });

  test('falls back to a neutral emoji on unknown transitions', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);

    const res = await postWebhook(app, {
      ...TRIGGERED_PAYLOAD,
      transition: 'Something New',
    });
    expect(res.status).toBe(200);

    const [content] = poster.mock.calls[0] as unknown as [string];
    expect(content.startsWith('📟 [Datadog]')).toBe(true);
  });

  test('omits empty optional fields', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);

    const res = await postWebhook(app, {
      title: '[Triggered] Some monitor',
      transition: 'Triggered',
    });
    expect(res.status).toBe(200);

    const [content] = poster.mock.calls[0] as unknown as [string];
    expect(content).toBe('🚨 [Datadog] [Triggered] Some monitor');
  });

  test('returns 502 when the channel post fails', async () => {
    const poster = mock(async () => {
      throw new Error('channel webhook post failed (500)');
    });
    const app = makeApp(poster);
    const res = await postWebhook(app, TRIGGERED_PAYLOAD);
    expect(res.status).toBe(502);
  });
});
