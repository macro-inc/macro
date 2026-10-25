import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('scheduled drafts clamp page size and advance by the actual request limit', async () => {
  const queries: URLSearchParams[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      const query = new URL(request.url).searchParams;
      queries.push(query);
      return Response.json({
        messages:
          query.get('offset') === '0'
            ? Array.from({ length: 1000 }, (_, i) => ({ db_id: `draft-${i}` }))
            : [],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  expect(
    await Array.fromAsync(macro.email.scheduled({ pageSize: 2000 })),
  ).toHaveLength(1000);
  expect(queries.map((q) => [q.get('offset'), q.get('limit')])).toEqual([
    ['0', '1000'],
    ['1000', '1000'],
  ]);
  for (const pageSize of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(
      Array.fromAsync(macro.email.scheduled({ pageSize })),
    ).rejects.toThrow('pageSize must be positive');
  }
  expect(queries).toHaveLength(2);
});

test('reminders and team calendar replace relation IDs with handles', async () => {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (new URL(request.url).pathname === '/reminders/email/collection') {
        return Response.json({
          items: [{ threadId: 'thread-1', title: 'Follow up' }],
        });
      }
      return Response.json({
        items: [{ ownerId: 'user-1', title: 'Busy' }],
        members: [],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const [reminder] = await Array.fromAsync(macro.email.reminders());
  expect(reminder.thread.id).toBe('thread-1');
  expect(reminder).not.toHaveProperty('threadId');
  const page = await macro.calendar.teamPage({
    start: '2026-10-20T00:00:00Z',
    end: '2026-10-21T00:00:00Z',
  });
  expect(page.items[0].owner.id).toBe('user-1');
  expect(page.items[0]).not.toHaveProperty('ownerId');
  expect(page.items[0]).toHaveProperty('title', 'Busy');
});

test('access resolution accepts equivalent handles and rejects different entities', async () => {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      const record = {
        id: 'request-1',
        requesterId: 'user-1',
        requestedLevel: 'view',
        revision: 1,
        status: 'pending',
        createdAt: '',
        updatedAt: '',
      };
      return Response.json(
        request.method === 'GET'
          ? {
              requests: [record],
              canReview: true,
              pendingCount: 1,
              supportedLevels: ['view'],
            }
          : { ...record, status: 'granted', revision: 2 },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const [request] = (await macro.documents.byId('doc-1').access.state())
    .requests;
  await macro.documents
    .byId('doc-1')
    .access.resolve(request, { revision: 1, grantedLevel: 'view' });
  expect(requests[1].method).toBe('POST');
  await expect(
    macro.documents.byId('doc-2').access.resolve(request, { revision: 1 }),
  ).rejects.toThrow('another entity');
  await expect(
    macro.chats.byId('doc-1').access.resolve(request, { revision: 1 }),
  ).rejects.toThrow('another entity');
  expect(requests).toHaveLength(2);
});
