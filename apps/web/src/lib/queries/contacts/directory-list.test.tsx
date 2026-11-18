import { cleanup, render } from '@solidjs/testing-library';
import {
  hashKey,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContactDirectoryPage, readContactDirectory } from './directory';
import { createContactDirectoryList } from './directory-list';

vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const VIEWER = 'macro|viewer@example.com';

function person(index: number) {
  return {
    id: `macro|person${index}@example.com`,
    email: `person${index}@example.com`,
    name: `Person ${index}`,
  };
}

/** Pages of three people that overlap by one, ending after the third page. */
function overlappingPage(
  request: Parameters<typeof readContactDirectory>[2]
): ContactDirectoryPage {
  const start =
    request.cursor?.source === 'people' ? Number(request.cursor.after) : 0;
  return {
    query: request.query,
    source: 'cache',
    sync: 'snapshot',
    offline: false,
    users: [0, 1, 2].map((offset) => person(start + offset)),
    nextCursor:
      start < 4
        ? {
            source: 'people',
            generation: 'fixture',
            after: String(start + 2),
            userId: VIEWER,
            query: request.query,
            policyKey: hashKey([request.policy]),
          }
        : null,
  };
}

function mountList(
  reader: typeof readContactDirectory,
  eligible?: (user: { id: string }) => boolean
) {
  const client = new QueryClient();
  const [search, setSearch] = createSignal('');
  let list: ReturnType<typeof createContactDirectoryList> | undefined;
  function Harness() {
    list = createContactDirectoryList(
      () => ({ userId: VIEWER }),
      reader,
      () => true,
      { search, debounceMs: 0, eligible }
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  return { client, list: () => list!, setSearch };
}

const ids = (list: ReturnType<typeof createContactDirectoryList>) =>
  list.data()?.users.map((user) => user.id);

it('lists each page below the earlier ones once, keeping them on screen while the next is read', async () => {
  vi.useFakeTimers();
  let release: (() => void) | undefined;
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => {
      if (request.cursor) {
        const { promise, resolve } = Promise.withResolvers<void>();
        release = resolve;
        await promise;
      }
      return overlappingPage(request);
    });
  const { client, list } = mountList(reader);
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(list())).toEqual([person(0).id, person(1).id, person(2).id]);

  // Two requests for the same page read it once; the rows already listed
  // stay until it lands.
  const first = list().loadNext();
  const second = list().loadNext();
  await vi.advanceTimersByTimeAsync(0);
  expect(reader).toHaveBeenCalledTimes(2);
  expect(list().loadingMore()).toBe(true);
  expect(ids(list())).toEqual([person(0).id, person(1).id, person(2).id]);
  const windowKey = list().windowKey();
  release?.();
  await Promise.all([first, second]);
  await vi.advanceTimersByTimeAsync(0);
  // The page overlapping the first by one row adds only the new rows.
  expect(ids(list())).toEqual([
    person(0).id,
    person(1).id,
    person(2).id,
    person(3).id,
    person(4).id,
  ]);
  expect(list().windowKey()).toBe(windowKey);

  const third = list().loadNext();
  await vi.advanceTimersByTimeAsync(0);
  release?.();
  await third;
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(list())).toHaveLength(7);
  expect(list().data()?.nextCursor).toBeNull();
  await list().loadNext();
  expect(reader).toHaveBeenCalledTimes(3);
  client.clear();
});

it('keeps listed rows through a failed page and starts again at page one for a new search', async () => {
  vi.useFakeTimers();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => {
      if (request.cursor && request.query === '')
        throw new Error('page failed');
      return overlappingPage(request);
    });
  const { client, list, setSearch } = mountList(reader);
  await vi.advanceTimersByTimeAsync(0);
  await expect(list().loadNext()).rejects.toThrow('page failed');
  await vi.advanceTimersByTimeAsync(0);
  expect(list().error()).toBeTruthy();
  expect(ids(list())).toEqual([person(0).id, person(1).id, person(2).id]);
  expect(list().loadingMore()).toBe(false);

  setSearch('person');
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.mock.calls.at(-1)?.[2]).toMatchObject({
    query: 'person',
    cursor: undefined,
  });
  expect(ids(list())).toEqual([person(0).id, person(1).id, person(2).id]);
  await list().loadNext();
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(list())).toHaveLength(5);
  client.clear();
});

it('keeps listed rows without a continuation while a contact change re-reads page one', async () => {
  vi.useFakeTimers();
  let release: (() => void) | undefined;
  let holdFirstPage = false;
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => {
      if (!request.cursor && holdFirstPage) {
        const { promise, resolve } = Promise.withResolvers<void>();
        release = resolve;
        await promise;
      }
      return overlappingPage(request);
    });
  const { client, list } = mountList(reader);
  await vi.advanceTimersByTimeAsync(0);
  await list().loadNext();
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(list())).toHaveLength(5);

  holdFirstPage = true;
  list().restart();
  await vi.advanceTimersByTimeAsync(0);
  // The rows stay on screen, but nothing can be continued until page one
  // lands: a request now would have no page to advance from.
  expect(ids(list())).toHaveLength(5);
  expect(list().data()?.nextCursor).toBeNull();
  const reads = reader.mock.calls.length;
  await list().loadNext();
  expect(reader).toHaveBeenCalledTimes(reads);

  release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(list())).toEqual([
    person(0).id,
    person(1).id,
    person(2).id,
    person(3).id,
    person(4).id,
  ]);
  expect(list().data()?.nextCursor).not.toBeNull();
  client.clear();
});

it('starts at page one when the search returns to an earlier input before the other lands', async () => {
  vi.useFakeTimers();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => {
      // The other search never answers, as a slow read would not in time.
      if (request.query === 'person') await new Promise(() => {});
      return overlappingPage(request);
    });
  const { client, list, setSearch } = mountList(reader);
  await vi.advanceTimersByTimeAsync(0);
  await list().loadNext();
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(list())).toHaveLength(5);

  setSearch('person');
  await vi.advanceTimersByTimeAsync(0);
  setSearch('');
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(list())).toEqual([person(0).id, person(1).id, person(2).id]);
  client.clear();
});

it('lists only eligible rows, so dropped rows never count toward the bound', async () => {
  vi.useFakeTimers();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) =>
      overlappingPage(request)
    );
  const { client, list } = mountList(
    reader,
    (user) => user.id !== person(1).id
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(ids(list())).toEqual([person(0).id, person(2).id]);
  client.clear();
});
