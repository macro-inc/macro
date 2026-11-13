import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Macro } from '../src/macro';

afterEach(() => mock.restore());

// The inbox route as the server pages it: `limit` threads per request (20
// when the caller names none) and a cursor whenever the page came back full.
function serveInbox(threadCount: number) {
  const limits: (string | null)[] = [];
  const fetchMock = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      expect(url.pathname).toBe('/email/threads/previews/cursor/inbox');
      limits.push(url.searchParams.get('limit'));

      const limit = Number(url.searchParams.get('limit') ?? 20);
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const end = Math.min(start + limit, threadCount);
      const items = Array.from({ length: end - start }, (_, index) => ({
        id: `thread-${start + index}`,
      }));
      return Response.json({
        items,
        next_cursor: items.length === limit ? String(end) : null,
      });
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  return limits;
}

function client() {
  return new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { email: 'https://email.example.test' },
  });
}

test('iterating a 200-thread inbox asks for 50 threads per request', async () => {
  const limits = serveInbox(200);

  const ids: string[] = [];
  for await (const thread of client().email.inbox()) ids.push(thread.id);

  expect(ids).toHaveLength(200);
  expect(ids[199]).toBe('thread-199');
  // Four full pages and the empty page that ends the list.
  expect(limits).toEqual(['50', '50', '50', '50', '50']);
});

test('pageSize sets the request size, capped at the 500 the route allows', async () => {
  const limits = serveInbox(30);

  for await (const _ of client().email.inbox({ pageSize: 20 })) {
    // drain
  }
  for await (const _ of client().email.inbox({ pageSize: 5000 })) {
    // drain
  }

  expect(limits).toEqual(['20', '20', '500']);
  expect(() => client().email.inbox({ pageSize: 0 })).toThrow(
    'pageSize must be positive',
  );
});
