import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const macro = () =>
  new Macro({
    token: 'test-token',
    hosts: {
      search: 'https://search.test',
      properties: 'https://properties.test',
      storage: 'https://storage.test',
    },
  });

/** Serves one page of channel message hits and records every other request. */
function serveMessageHits() {
  const otherRequests: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/search')
      return Response.json({
        results: [
          {
            type: 'channelMessage',
            id: 'channel-1',
            channel_id: 'channel-1',
            channel_type: 'private',
            message_id: 'message-1',
            thread_id: null,
            sender_id: 'macro|sender-1',
            created_at: '2026-11-27T22:20:35.582Z',
            updated_at: '2026-11-27T22:20:35.582Z',
            highlight: { content: ['a match'] },
          },
          {
            type: 'channelMessage',
            id: 'channel-2',
            channel_id: 'channel-2',
            channel_type: 'public',
            message_id: 'message-2',
            thread_id: 'message-0',
            sender_id: 'macro|sender-2',
            created_at: '2026-11-26T08:40:44.281Z',
            updated_at: '2026-11-26T08:40:44.281Z',
            highlight: { content: ['another match'] },
          },
        ],
        next_cursor: null,
      });
    otherRequests.push(url.pathname);
    if (url.pathname === '/messages/channel/channel-1/items/message-1')
      return Response.json({
        id: 'message-1',
        content: 'the full body',
        sender_id: 'macro|sender-1',
        created_at: '2026-11-27T22:20:35.582123Z',
        updated_at: '2026-11-27T22:20:35.582123Z',
        thread_id: null,
        mentions: [],
      });
    return new Response('unexpected request', { status: 500 });
  }) as typeof fetch;
  return otherRequests;
}

test('a channel message search hit answers createdAt and author without reading the message', async () => {
  const otherRequests = serveMessageHits();

  const page = await macro().search.page('match', { types: ['channel'] });
  const read = await Promise.all(
    page.results.map(async (result) => {
      if (result.type !== 'channel_message')
        throw new Error('expected a channel message');
      const author = await result.entity.author();
      return { createdAt: await result.entity.createdAt(), author: author.id };
    }),
  );

  expect(read).toEqual([
    { createdAt: '2026-11-27T22:20:35.582Z', author: 'macro|sender-1' },
    { createdAt: '2026-11-26T08:40:44.281Z', author: 'macro|sender-2' },
  ]);
  expect(otherRequests).toEqual([]);
});

test('a channel message search hit still reads the message for its content', async () => {
  const otherRequests = serveMessageHits();

  const page = await macro().search.page('match', { types: ['channel'] });
  const [first] = page.results;
  if (first?.type !== 'channel_message')
    throw new Error('expected a channel message');

  expect(await first.entity.content()).toBe('the full body');
  expect(otherRequests).toEqual([
    '/messages/channel/channel-1/items/message-1',
  ]);
});

test('a channel message search hit without its time loads the message for createdAt', async () => {
  globalThis.fetch = (async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/search')
      return Response.json({
        results: [
          {
            type: 'channelMessage',
            id: 'channel-1',
            channel_id: 'channel-1',
            channel_type: 'private',
            message_id: 'message-1',
            sender_id: 'macro|sender-1',
            created_at: '1970-01-01T00:00:00Z',
            updated_at: '1970-01-01T00:00:00Z',
            highlight: { content: ['a match'] },
          },
        ],
        next_cursor: null,
      });
    if (url.pathname === '/messages/channel/channel-1/items/message-1')
      return Response.json({
        id: 'message-1',
        content: 'the full body',
        sender_id: 'macro|sender-1',
        created_at: '2026-11-27T22:20:35.582123Z',
        updated_at: '2026-11-27T22:20:35.582123Z',
        thread_id: null,
        mentions: [],
      });
    return new Response('unexpected request', { status: 500 });
  }) as typeof fetch;

  const page = await macro().search.page('match', { types: ['channel'] });
  const [first] = page.results;
  if (first?.type !== 'channel_message')
    throw new Error('expected a channel message');

  expect(await first.entity.createdAt()).toBe('2026-11-27T22:20:35.582123Z');
});
