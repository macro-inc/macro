import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Macro } from '../src/macro';

afterEach(() => mock.restore());

// The trash as `/recents/deleted` pages it: `limit` items per request (100
// when the caller names none), a mix of documents, chats and folders, and a
// `next_cursor` only while more remain.
function serveTrash(items: { type: string; id: string }[]) {
  const requests: { limit: string | null; cursor: string | null }[] = [];
  const fetchMock = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      expect(url.pathname).toBe('/recents/deleted');
      const limit = url.searchParams.get('limit');
      const cursor = url.searchParams.get('cursor');
      requests.push({ limit, cursor });

      const start = Number(cursor ?? 0);
      const end = Math.min(start + Number(limit ?? 100), items.length);
      return Response.json({
        error: false,
        data: {
          items: items.slice(start, end),
          next_cursor: end < items.length ? String(end) : null,
        },
      });
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  return requests;
}

function client() {
  return new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { storage: 'https://storage.example.test' },
  });
}

const TRASH = Array.from({ length: 250 }, (_, index) => ({
  type: index % 5 === 0 ? 'chat' : 'document',
  id: `item-${index}`,
}));

test('trashed() follows the cursor through the whole trash, documents only', async () => {
  const requests = serveTrash(TRASH);

  const ids: string[] = [];
  for await (const document of client().documents.trashed()) {
    ids.push(document.id);
  }

  expect(ids).toHaveLength(200);
  expect(ids[0]).toBe('item-1');
  expect(ids[199]).toBe('item-249');
  expect(requests).toEqual([
    { limit: null, cursor: null },
    { limit: null, cursor: '100' },
    { limit: null, cursor: '200' },
  ]);
});

test('trashed() asks for pageSize items per request and stops when the caller does', async () => {
  const requests = serveTrash(TRASH);

  for await (const document of client().documents.trashed({ pageSize: 20 })) {
    if (document.id === 'item-21') break;
  }

  expect(requests).toEqual([
    { limit: '20', cursor: null },
    { limit: '20', cursor: '20' },
  ]);
});

test('recentlyDeleted() reads only the first page', async () => {
  const requests = serveTrash(TRASH);

  const documents = await client().documents.recentlyDeleted();

  expect(documents).toHaveLength(80);
  expect(requests).toEqual([{ limit: null, cursor: null }]);
});
