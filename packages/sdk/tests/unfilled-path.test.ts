import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a request whose path still has a {param} throws, and is never sent', async () => {
  const sent: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    sent.push(input instanceof Request ? input.url : String(input));
    return new Response('{}', {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const macro = new Macro({ auth: { type: 'user', apiKey: 'mak_test' } });
  const channel = '0190a3c4-0000-7000-8000-0000000000d1';
  // What a caller passing the wrong field name ends up with.
  const message = macro.channels
    .byId(channel)
    .message(undefined as unknown as string);
  await expect(message.content()).rejects.toThrow(
    `GET /dss/messages/channel/${channel}/items/{id}: no value for id`,
  );
  expect(sent).toEqual([]);
});

test('a filled path is sent as it is', async () => {
  const sent: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    sent.push(input instanceof Request ? input.url : String(input));
    return new Response(JSON.stringify({ channel_id: 'c' }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const macro = new Macro({ auth: { type: 'user', apiKey: 'mak_test' } });
  await macro.channels.byId('0190a3c4-0000-7000-8000-0000000000d1').type();
  expect(sent.map((url) => new URL(url).pathname)).toEqual([
    '/dss/channels/0190a3c4-0000-7000-8000-0000000000d1',
  ]);
});
