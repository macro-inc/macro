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

it('orders the first server page by who the viewer works with, and leaves later pages below it', async () => {
  vi.useFakeTimers();
  const user = (email: string, name: string) => ({
    id: `macro|${email}`,
    email,
    name,
  });
  // As the server window lists them: the named people, then loose matches.
  const firstPage = [
    user('aaron@example.com', 'Teo Aaron'),
    user('teo.dm@example.com', 'Teo Baker'),
    user('teo.old@example.com', 'Teo Olde'),
    user('teo.nys@example.com', 'Teo Nys'),
    user('teodora@example.com', 'Teodora Vance'),
    user('prefix.dm@example.com', 'Teon Dale'),
    user('mateo@example.com', 'Mateo Rossi'),
    user('loose.mate@example.com', 'Stevie Leon'),
    user('loose.dm@example.com', 'Tate Eton'),
  ];
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (viewer, _host, request) => ({
      query: request.query,
      source: 'server',
      sync: 'unavailable',
      offline: false,
      users: request.cursor
        ? [user('later.dm@example.com', 'Otto Tennel')]
        : firstPage,
      ...(request.cursor
        ? {}
        : {
            named: {
              exact: [
                'macro|aaron@example.com',
                'macro|teo.dm@example.com',
                'macro|teo.old@example.com',
                'macro|teo.nys@example.com',
              ],
              wordStart: [
                'macro|teodora@example.com',
                'macro|prefix.dm@example.com',
              ],
            },
          }),
      nextCursor: request.cursor
        ? null
        : {
            source: 'server',
            after: 'next',
            userId: viewer,
            query: request.query,
            policyKey: hashKey([request.policy]),
          },
    }));
  const client = new QueryClient();
  const [teammates, setTeammates] = createSignal<ReadonlySet<string>>(
    new Set([
      'macro|teo.nys@example.com',
      'macro|teodora@example.com',
      'macro|loose.mate@example.com',
    ])
  );
  let list: ReturnType<typeof createContactDirectoryList> | undefined;
  function Harness() {
    const [search] = createSignal('teo');
    list = createContactDirectoryList(
      () => ({ userId: VIEWER }),
      reader,
      () => true,
      {
        search,
        debounceMs: 0,
        teammates,
        directMessages: () =>
          new Map([
            ['macro|teo.old@example.com', '2026-01-05T00:00:00Z'],
            ['macro|teo.dm@example.com', '2026-03-01T00:00:00Z'],
            ['macro|prefix.dm@example.com', '2026-06-01T00:00:00Z'],
            ['macro|loose.dm@example.com', '2026-02-01T00:00:00Z'],
            ['macro|later.dm@example.com', '2026-07-01T00:00:00Z'],
          ]),
      }
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.mock.calls[0][2].teammates).toEqual([
    'macro|loose.mate@example.com',
    'macro|teo.nys@example.com',
    'macro|teodora@example.com',
  ]);
  const names = () => list?.data()?.users.map((row) => row.name);
  expect(names()).toEqual([
    // Named, direct-message partners: exact by recency, then a word start.
    'Teo Baker',
    'Teo Olde',
    'Teon Dale',
    // Named teammates never messaged: exact, then a word start.
    'Teo Nys',
    'Teodora Vance',
    // Named, everyone else.
    'Teo Aaron',
    // Loose matches, in the same three groups.
    'Tate Eton',
    'Stevie Leon',
    'Mateo Rossi',
  ]);

  // A later page is listed below, whoever is on it.
  await list?.loadNext();
  await vi.advanceTimersByTimeAsync(0);
  expect(names()?.slice(-2)).toEqual(['Mateo Rossi', 'Otto Tennel']);

  // A roster that changes reads page one again and orders it anew.
  const reads = reader.mock.calls.length;
  setTeammates(new Set(['macro|aaron@example.com']));
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.mock.calls).toHaveLength(reads + 1);
  expect(reader.mock.lastCall?.[2]).toMatchObject({
    cursor: undefined,
    teammates: ['macro|aaron@example.com'],
  });
  expect(names()?.slice(3, 6)).toEqual([
    'Teo Aaron',
    'Teo Nys',
    'Teodora Vance',
  ]);
  client.clear();
});

it('ranks a teammate whose listed ID differs from the roster only in case', async () => {
  vi.useFakeTimers();
  const stranger = {
    id: 'macro|teo.amy@example.com',
    email: 'teo.amy@example.com',
    name: 'Teo Amy',
  };
  const teammate = {
    id: 'macro|Teo.Zed@Example.com',
    email: 'Teo.Zed@Example.com',
    name: 'Teo Zed',
  };
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => ({
      query: request.query,
      source: 'server',
      sync: 'unavailable',
      offline: false,
      users: [stranger, teammate],
      named: { exact: [stranger.id, teammate.id], wordStart: [] },
      nextCursor: null,
    }));
  const client = new QueryClient();
  let list: ReturnType<typeof createContactDirectoryList> | undefined;
  function Harness() {
    const [search] = createSignal('teo');
    list = createContactDirectoryList(
      () => ({ userId: VIEWER }),
      reader,
      () => true,
      {
        search,
        debounceMs: 0,
        teammates: () => new Set(['macro|teo.zed@example.com']),
      }
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  expect(list?.data()?.users.map((user) => user.name)).toEqual([
    'Teo Zed',
    'Teo Amy',
  ]);
  client.clear();
});

it('keeps the bound when a server page names more people than it', async () => {
  vi.useFakeTimers();
  const everyone = Array.from({ length: 520 }, (_, index) => person(index));
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (viewer, _host, request) => ({
      query: request.query,
      source: 'server',
      sync: 'unavailable',
      offline: false,
      users: everyone,
      named: { exact: [], wordStart: everyone.map((user) => user.id) },
      nextCursor: {
        source: 'server',
        after: 'next',
        userId: viewer,
        query: request.query,
        policyKey: hashKey([request.policy]),
      },
    }));
  const client = new QueryClient();
  let list: ReturnType<typeof createContactDirectoryList> | undefined;
  function Harness() {
    const [search] = createSignal('person');
    list = createContactDirectoryList(
      () => ({ userId: VIEWER }),
      reader,
      () => true,
      { search, debounceMs: 0 }
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  expect(list?.data()?.users).toHaveLength(500);
  expect(list?.data()?.users[499].id).toBe(person(499).id);
  expect(list?.data()?.nextCursor).toBeNull();
  client.clear();
});

it('reads the roster only for a typed search, so browsing keeps its pages when it loads', async () => {
  vi.useFakeTimers();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) =>
      overlappingPage(request)
    );
  const client = new QueryClient();
  const [teammates, setTeammates] = createSignal<ReadonlySet<string>>(
    new Set()
  );
  const [search, setSearch] = createSignal('');
  let list: ReturnType<typeof createContactDirectoryList> | undefined;
  function Harness() {
    list = createContactDirectoryList(
      () => ({ userId: VIEWER }),
      reader,
      () => true,
      { search, debounceMs: 0, teammates }
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const shown = () => list?.data()?.users.map((user) => user.id);
  await vi.advanceTimersByTimeAsync(0);
  await list?.loadNext();
  await vi.advanceTimersByTimeAsync(0);
  const browsed = shown();
  expect(browsed).toHaveLength(5);

  // The roster arrives while two browsed pages are listed.
  const reads = reader.mock.calls.length;
  setTeammates(new Set([person(9).id]));
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.mock.calls).toHaveLength(reads);
  expect(shown()).toEqual(browsed);
  expect(reader.mock.calls.every(([, , request]) => !request.teammates)).toBe(
    true
  );

  setSearch('per');
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.mock.lastCall?.[2]).toMatchObject({
    query: 'per',
    teammates: [person(9).id],
  });
  client.clear();
});
