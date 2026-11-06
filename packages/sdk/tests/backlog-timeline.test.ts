import { afterEach, expect, test } from 'bun:test';
import type { MessageListItem } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const message: MessageListItem = {
  id: 'message-1',
  parent: { type: 'channel', id: 'channel-1' },
  sender_id: 'owner-1',
  content: 'Snapshot content',
  created_at: '',
  updated_at: '',
  mentions: [],
  reactions: [],
  attachments: [],
  state: {
    root_id: 'message-1',
    resolved: false,
    user_id: 'owner-1',
    created_at: '',
    updated_at: '',
  },
  thread: { reply_count: 0, preview: [] },
};
test('mixed timeline seeds typed messages without refetching and maps typed selectors', async () => {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json({
        entries: [
          { type: 'message', message },
          {
            type: 'activity',
            activity: {
              id: 'activity-1',
              actor_id: 'actor-1',
              action: 'updated',
              occurred_at: '',
            },
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const channel = macro.channels.byId('channel-1');
  const page = await channel.timelinePage({
    messages: [channel.message('message-1')],
    includeDeletedThreads: true,
    activityAfter: '2026-10-01T00:00:00Z',
  });
  const first = page.entries[0];
  if (first.type !== 'message') throw new Error('Expected message');
  expect(await first.message.content()).toBe('Snapshot content');
  const second = page.entries[1];
  if (second.type !== 'activity') throw new Error('Expected activity');
  expect(second.activity.actor.id).toBe('actor-1');
  expect(requests).toHaveLength(1);
  expect(
    JSON.parse(new URL(requests[0].url).searchParams.get('selection') ?? '{}'),
  ).toEqual({
    ids: ['message-1'],
    include_deleted_threads: true,
    activity_after: '2026-10-01T00:00:00Z',
  });
  await expect(
    channel.timelinePage({
      around: macro.channels.byId('other-channel').message('message-1'),
    }),
  ).rejects.toThrow('another resource');
  expect(requests).toHaveLength(1);
});

test('thread mutation paths retain document parent scope across cache invalidation', async () => {
  const requests: Request[] = [];
  let resolved = false;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.method === 'PATCH') resolved = true;
      const state = {
        root_id: 'thread-1',
        resolved,
        user_id: 'owner',
        created_at: '',
        updated_at: '',
      };
      return Response.json(
        request.method === 'GET' ? { state, root: {}, replies: [] } : state,
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const thread = macro.documents.byId('doc-1').messageThreadById('thread-1');
  expect(await thread.resolved()).toBe(false);
  await thread.update({ resolved: true, nonce: 'operation-1' });
  expect(await thread.resolved()).toBe(true);
  await thread.delete('operation-2');
  expect(
    requests.every(
      (r) =>
        new URL(r.url).pathname === '/messages/document/doc-1/threads/thread-1',
    ),
  ).toBe(true);
  expect(await requests[1].json()).toEqual({
    resolved: true,
    nonce: 'operation-1',
  });
  expect(JSON.stringify(thread)).toContain('"parentId":"doc-1"');
});
