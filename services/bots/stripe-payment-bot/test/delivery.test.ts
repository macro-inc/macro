import { expect, spyOn, test } from 'bun:test';
import { broadcast } from '../src/channel';
import { InvoiceDelivery, type Receipt } from '../src/delivery';

test('invoice retry recovers partial delivery and lost acknowledgement across object restarts', async () => {
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
    MACRO_BOT_TOKEN: 'mbot_fixture',
    MACRO_ENV: 'prod' as const,
    MACRO_STORAGE_URL: 'https://storage.test',
    INVOICE_DELIVERIES: {
      getByName(name: string): InvoiceDelivery {
        let object = objects.get(name);
        if (!object) {
          const storage = {
            get: async () => receipts.get(name),
            put: async (_key: string, receipt: Receipt) => {
              receipts.set(name, receipt);
            },
          };
          object = new InvoiceDelivery({ storage }, env);
          objects.set(name, object);
        }
        return object;
      },
    },
  };
  const send = () => broadcast(env, 'Subscription renewal', 'in_renewal');
  try {
    await expect(send()).rejects.toThrow('Failed to post');
    expect([...messages.keys()].sort()).toEqual(['lost-response', 'money']);
    objects.clear();
    await Promise.all([send(), send()]);
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
