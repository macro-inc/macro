import { expect, spyOn, test } from 'bun:test';
import Stripe from 'stripe';
import type { Receipt } from '../src/delivery';
import worker, { InvoiceDelivery } from '../src/worker';

test('signed webhook retry recovers partial delivery and lost acknowledgement across object restarts', async () => {
  const channels = ['money', 'failed', 'lost-response'];
  const messages = new Map<string, string>();
  const attempts: string[] = [];
  const handler = async (input: RequestInfo | URL) => {
    const request = new Request(input);
    const path = new URL(request.url).pathname;
    if (path === '/bots/me') return Response.json({ id: 'test-bot' });
    if (path === '/bots/test-bot/channels')
      return Response.json(channels.map((channel_id) => ({ channel_id })));
    const [, , , channel, , messageId] = path.split('/');
    if (request.method === 'GET') {
      return messages.get(channel) === messageId
        ? Response.json({ id: messageId })
        : Response.json({}, { status: 404 });
    }
    const { id } = await request.json();
    const first = !attempts.includes(channel);
    attempts.push(channel);
    if (first && channel === 'failed')
      return Response.json({}, { status: 503 });
    if (messages.has(channel)) throw new Error('Duplicate post');
    messages.set(channel, id);
    if (first && channel === 'lost-response')
      throw new Error('Response lost after commit');
    return Response.json({ id });
  };
  const network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(handler, { preconnect: fetch.preconnect })
  );

  const receipts = new Map<string, Receipt>();
  const objects = new Map<string, InvoiceDelivery>();
  const env = {
    STRIPE_API_KEY: 'sk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    MACRO_BOT_TOKEN: 'mbot_fixture',
    MACRO_ENV: 'prod' as const,
    MACRO_STORAGE_URL: 'https://storage.test',
    INVOICE_DELIVERIES: {
      getByName(name: string): InvoiceDelivery {
        let object = objects.get(name);
        if (!object) {
          object = new InvoiceDelivery(
            {
              storage: {
                async get() {
                  return receipts.get(name);
                },
                async put(_key, receipt) {
                  receipts.set(name, receipt);
                },
              },
            },
            env
          );
          objects.set(name, object);
        }
        return object;
      },
    },
  };
  async function send(eventId: string) {
    const payload = JSON.stringify({
      id: eventId,
      type: 'invoice.paid',
      livemode: true,
      data: {
        object: {
          id: 'in_renewal',
          status: 'paid',
          billing_reason: 'subscription_cycle',
          amount_paid: 4250,
          currency: 'usd',
          lines: { data: [] },
          parent: { subscription_details: { subscription: 'sub_team' } },
        },
      },
    });
    const signature = await new Stripe(
      env.STRIPE_API_KEY
    ).webhooks.generateTestHeaderStringAsync({
      payload,
      secret: env.STRIPE_WEBHOOK_SECRET,
    });
    return worker.fetch(
      new Request('https://worker.test/webhook', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': signature },
      }),
      env
    );
  }
  try {
    expect((await send('evt_first')).status).toBe(502);
    expect([...messages.keys()].sort()).toEqual(['lost-response', 'money']);
    objects.clear();
    const retries = await Promise.all([send('evt_first'), send('evt_second')]);
    expect(retries.map((response) => response.status)).toEqual([200, 200]);
    expect(messages.size).toBe(3);
    expect(attempts.sort()).toEqual([
      'failed',
      'failed',
      'lost-response',
      'money',
    ]);
  } finally {
    network.mockRestore();
  }
});
