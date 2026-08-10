import { describe, expect, mock, test } from 'bun:test';
import { createApp } from '../src/index';

// Exact example payloads from the Atlassian Statuspage webhook docs:
// https://support.atlassian.com/statuspage/docs/enable-webhook-notifications/
const INCIDENT_PAYLOAD = {
  meta: {
    unsubscribe:
      'http://statustest.flyingkleinbrothers.com:5000/?unsubscribe=j0vqr9kl3513',
    documentation:
      'http://doers.statuspage.io/customer-notifications/webhooks/',
  },
  page: {
    id: 'j2mfxwj97wnj',
    status_indicator: 'critical',
    status_description: 'Major System Outage',
  },
  incident: {
    backfilled: false,
    created_at: '2013-05-29T15:08:51-06:00',
    impact: 'critical',
    impact_override: null,
    monitoring_at: '2013-05-29T16:07:53-06:00',
    postmortem_body: null,
    postmortem_body_last_updated_at: null,
    postmortem_ignored: false,
    postmortem_notified_subscribers: false,
    postmortem_notified_twitter: false,
    postmortem_published_at: null,
    resolved_at: null,
    scheduled_auto_transition: false,
    scheduled_for: null,
    scheduled_remind_prior: false,
    scheduled_reminded_at: null,
    scheduled_until: null,
    shortlink: 'http://j.mp/18zyDQx',
    status: 'monitoring',
    updated_at: '2013-05-29T16:30:35-06:00',
    id: 'lbkhbwn21v5q',
    organization_id: 'j2mfxwj97wnj',
    incident_updates: [
      {
        body: 'A fix has been implemented and we are monitoring the results.',
        created_at: '2013-05-29T16:07:53-06:00',
        display_at: '2013-05-29T16:07:53-06:00',
        status: 'monitoring',
        twitter_updated_at: null,
        updated_at: '2013-05-29T16:09:09-06:00',
        wants_twitter_update: false,
        id: 'drfcwbnpxnr6',
        incident_id: 'lbkhbwn21v5q',
      },
      {
        body: 'We are waiting for the cloud to come back online and will update when we have further information',
        created_at: '2013-05-29T15:18:51-06:00',
        display_at: '2013-05-29T15:18:51-06:00',
        status: 'identified',
        twitter_updated_at: null,
        updated_at: '2013-05-29T15:28:51-06:00',
        wants_twitter_update: false,
        id: '2rryghr4qgrh',
        incident_id: 'lbkhbwn21v5q',
      },
      {
        body: 'The cloud, located in Norther Virginia, has once again gone the way of the dodo.',
        created_at: '2013-05-29T15:08:51-06:00',
        display_at: '2013-05-29T15:08:51-06:00',
        status: 'investigating',
        twitter_updated_at: null,
        updated_at: '2013-05-29T15:28:51-06:00',
        wants_twitter_update: false,
        id: 'qbbsfhy5s9kk',
        incident_id: 'lbkhbwn21v5q',
      },
    ],
    name: 'Virginia Is Down',
  },
};

const COMPONENT_PAYLOAD = {
  meta: {
    unsubscribe:
      'http://statustest.flyingkleinbrothers.com:5000/?unsubscribe=j0vqr9kl3513',
    documentation:
      'http://doers.statuspage.io/customer-notifications/webhooks/',
  },
  page: {
    id: 'j2mfxwj97wnj',
    status_indicator: 'major',
    status_description: 'Partial System Outage',
  },
  component_update: {
    created_at: '2013-05-29T21:32:28Z',
    new_status: 'operational',
    old_status: 'major_outage',
    id: 'k7730b5v92bv',
    component_id: 'rb5wq1dczvbm',
  },
  component: {
    created_at: '2013-05-29T21:32:28Z',
    id: 'rb5wq1dczvbm',
    name: 'Some Component',
    status: 'operational',
  },
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

describe('anthropic-status-bot webhook', () => {
  test('health check', async () => {
    const app = makeApp(mock(async () => {}));
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('rejects wrong secret without posting', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);
    const res = await postWebhook(app, INCIDENT_PAYLOAD, 'wrong-secret');
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
    const res = await postWebhook(app, {
      page: {
        id: 'x',
        status_indicator: 'none',
        status_description: 'All Systems Operational',
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(poster).not.toHaveBeenCalled();
  });

  test('formats incident updates and posts them to the channel', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);

    const res = await postWebhook(app, INCIDENT_PAYLOAD);
    expect(res.status).toBe(200);

    expect(poster).toHaveBeenCalledTimes(1);
    const [content] = poster.mock.calls[0] as unknown as [string];
    expect(content).toContain('[Anthropic Status] Virginia Is Down');
    expect(content).toContain('Status: monitoring');
    expect(content).toContain('Impact: critical');
    // newest incident update wins
    expect(content).toContain(
      'Latest update: A fix has been implemented and we are monitoring the results.'
    );
    expect(content).toContain('Page status: Major System Outage');
    expect(content).toContain('http://j.mp/18zyDQx');
  });

  test('formats component updates and posts them to the channel', async () => {
    const poster = mock(async () => {});
    const app = makeApp(poster);

    const res = await postWebhook(app, COMPONENT_PAYLOAD);
    expect(res.status).toBe(200);

    const [content] = poster.mock.calls[0] as unknown as [string];
    expect(content).toContain(
      'Component "Some Component": major outage → operational'
    );
    expect(content).toContain('Page status: Partial System Outage');
  });

  test('returns 502 when the channel post fails', async () => {
    const poster = mock(async () => {
      throw new Error('channel webhook post failed (500)');
    });
    const app = makeApp(poster);
    const res = await postWebhook(app, INCIDENT_PAYLOAD);
    expect(res.status).toBe(502);
  });
});
