import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheChangeListener } from '@graphql-cache/host/types';
import type { PeopleCache } from '@graphql-cache/people/host';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { parseCacheRevision } from '@graphql-cache/protocol';
import {
  fetchContactDirectoryByIds,
  fetchContactDirectoryPage,
  fetchContactReferencePage,
} from '@service-storage/graphql-contacts';
import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createPersonList } from './person-list';

vi.mock('@queries/contacts/backfill', () => ({
  loadContactCheckpoint: () => ({ pages: 200, completedAt: 1 }),
}));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
  fetchContactReferencePage: vi.fn(),
  fetchContactDirectoryByIds: vi.fn(),
}));
afterEach(() => vi.useRealTimers());

it('lists further property pages below the first, forwards queries, and retains no query/name history', async () => {
  vi.useFakeTimers();
  const viewer = 'macro|viewer@example.com';
  const search = vi
    .fn<PeopleCache['search']>()
    .mockImplementation(async (request) => {
      const id = request.cursor ? 'next' : 'first';
      return {
        kind: 'page',
        policyVersion: 5,
        people: [
          {
            recordKey: `GraphqlContact:${id}`,
            userId: `macro|${id}@example.com`,
            email: `${id}@example.com`,
            name: request.query || id,
            lastInteractionMs: 0,
            matchRank: 2,
            score: 1,
            timestampMs: 0,
          },
        ],
        truncated: !request.cursor,
        nextCursor: request.cursor ? null : 'rank-position',
      };
    });
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    readQuery: async () => ({
      kind: 'hit' as const,
      data: { user: { id: viewer } },
    }),
    people: {
      ...unsupportedContactSync,
      readSql: vi
        .fn<PeopleCache['readSql']>()
        .mockResolvedValue({ kind: 'unsupported' }),
      resolveReferences: vi.fn<PeopleCache['resolveReferences']>(),
      search,
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
    },
  };
  const client = new QueryClient();
  const [query, setQuery] = createSignal('');
  let list: ReturnType<typeof createPersonList> | undefined;
  let committed = Promise.withResolvers<void>();
  function Harness() {
    list = createPersonList({
      scope: () => ({ userId: viewer, host }),
      search: query,
      enabled: () => true,
      // Property pickers list each further page below the earlier ones.
      policy: () => ({ mode: 'property', excluded: [viewer] }),
      activity: () => new Map(),
      conversation: () => undefined,
      excluded: () => false,
    });
    createEffect(() => {
      if (list?.items().length) committed.resolve();
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(200);
  await committed.promise;
  expect(list?.items().map((item) => item.id)).toEqual([
    'macro|first@example.com',
  ]);
  committed = Promise.withResolvers<void>();
  const next = list?.loadMore();
  await vi.runOnlyPendingTimersAsync();
  await next;
  await committed.promise;
  expect(list?.items().map((item) => item.id)).toEqual([
    'macro|first@example.com',
    'macro|next@example.com',
  ]);
  expect(list?.hasMore()).toBe(false);
  for (let i = 0; i < 10; i++) {
    committed = Promise.withResolvers<void>();
    setQuery(`name-${i}`);
    await vi.advanceTimersByTimeAsync(200);
    await committed.promise;
    await vi.runOnlyPendingTimersAsync();
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(list?.items()).toHaveLength(1);
  }
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: 'name-9',
      cursor: undefined,
      limit: 50,
      excluded: [viewer],
    })
  );
  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  client.clear();
});

it('keeps still-matching people listed while the next read is pending', async () => {
  vi.useFakeTimers();
  const viewer = 'macro|viewer@example.com';
  const directory = ['Jacob Adams', 'Jacob Baker', 'Jane Cole'];
  let changed: CacheChangeListener | undefined;
  const search = vi
    .fn<PeopleCache['search']>()
    .mockImplementation(async (request) => ({
      kind: 'page',
      policyVersion: 5,
      people: directory
        .filter((name) => name.toLowerCase().includes(request.query))
        .map((name) => {
          const id = name.toLowerCase().replace(' ', '.');
          return {
            recordKey: `GraphqlContact:${id}`,
            userId: `macro|${id}@example.com`,
            email: `${id}@example.com`,
            name,
            lastInteractionMs: 0,
            matchRank: 2,
            score: 1,
            timestampMs: 0,
          };
        }),
      truncated: false,
      nextCursor: null,
    }));
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    readQuery: async () => ({
      kind: 'hit' as const,
      data: { user: { id: viewer } },
    }),
    onCacheChanged: (callback: CacheChangeListener) => {
      changed = callback;
      return () => {};
    },
    people: {
      ...unsupportedContactSync,
      readSql: vi
        .fn<PeopleCache['readSql']>()
        .mockResolvedValue({ kind: 'unsupported' }),
      resolveReferences: vi.fn<PeopleCache['resolveReferences']>(),
      search,
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
    },
  };
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const client = new QueryClient();
  const [query, setQuery] = createSignal('j');
  let list: ReturnType<typeof createPersonList> | undefined;
  function Harness() {
    list = createPersonList({
      scope: () => ({ userId: viewer, host }),
      search: query,
      enabled: () => true,
      policy: () => ({ mode: 'command', excluded: [] }),
      activity: () => new Map(),
      conversation: () => undefined,
      excluded: () => false,
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const names = () => list?.items().map((item) => item.data.name);
  await vi.advanceTimersByTimeAsync(500);
  expect(names()).toEqual(directory);

  // Typing narrows what is shown at once; the read for the new text lands later.
  setQuery('jac');
  expect(names()).toEqual(['Jacob Adams', 'Jacob Baker']);
  await vi.advanceTimersByTimeAsync(500);
  expect(names()).toEqual(['Jacob Adams', 'Jacob Baker']);
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({ query: 'jac' })
  );

  // A contact change re-reads the page without emptying it, and a re-read
  // that finds the same people keeps the listed rows.
  const listed = list?.items();
  changed?.(parseCacheRevision('2'), { searchChangedBuckets: ['person'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(names()).toEqual(['Jacob Adams', 'Jacob Baker']);
  await vi.advanceTimersByTimeAsync(1000);
  expect(names()).toEqual(['Jacob Adams', 'Jacob Baker']);
  expect(search.mock.calls.length).toBeGreaterThan(2);
  expect(list?.items()).toBe(listed);

  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  client.clear();
  vi.restoreAllMocks();
});

it('keeps a still-matching person listed from the moment the text settles until its read lands', async () => {
  vi.useFakeTimers();
  const viewer = 'macro|viewer@example.com';
  const ada = {
    recordKey: 'GraphqlContact:ada',
    userId: 'macro|ada@example.com',
    email: 'ada@example.com',
    name: 'Ada',
    lastInteractionMs: 0,
    matchRank: 2,
    score: 1,
    timestampMs: 0,
  };
  const page = {
    kind: 'page' as const,
    policyVersion: 5,
    people: [ada],
    truncated: false,
    nextCursor: null,
  };
  // The read for the typed text is held, so the list sits between its text
  // settling and that read landing.
  const held = Promise.withResolvers<typeof page>();
  const search = vi
    .fn<PeopleCache['search']>()
    .mockImplementation(async (request) =>
      request.query ? held.promise : page
    );
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    readQuery: async () => ({
      kind: 'hit' as const,
      data: { user: { id: viewer } },
    }),
    people: {
      ...unsupportedContactSync,
      readSql: vi
        .fn<PeopleCache['readSql']>()
        .mockResolvedValue({ kind: 'unsupported' }),
      resolveReferences: vi.fn<PeopleCache['resolveReferences']>(),
      search,
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
    },
  };
  const client = new QueryClient();
  const [query, setQuery] = createSignal('');
  let list: ReturnType<typeof createPersonList> | undefined;
  const listed: number[] = [];
  function Harness() {
    // A mention menu: its text arrives debounced, so the list reads at once.
    list = createPersonList({
      scope: () => ({ userId: viewer, host }),
      search: query,
      enabled: () => true,
      policy: () => ({ mode: 'mention', excluded: [] }),
      activity: () => new Map(),
      conversation: () => undefined,
      excluded: () => false,
    });
    // Like a menu, read the rows next to whether the list is loading. A pure
    // computation runs before the query takes up a new key, so it sees each
    // step of the update.
    createMemo(() => {
      list?.isLoading();
      listed.push(list?.items().length ?? 0);
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const names = () => list?.items().map((item) => item.data.name);
  await vi.advanceTimersByTimeAsync(500);
  expect(names()).toEqual(['Ada']);

  listed.length = 0;
  setQuery('ada');
  await vi.advanceTimersByTimeAsync(500);
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({ query: 'ada' })
  );
  // Ada stays listed throughout: an empty menu here closes on Enter without
  // inserting the mention.
  expect(names()).toEqual(['Ada']);
  expect(listed).not.toContain(0);

  held.resolve(page);
  await vi.advanceTimersByTimeAsync(0);
  expect(names()).toEqual(['Ada']);
  expect(listed).not.toContain(0);

  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  client.clear();
});

it('lists the next page below the first when pages are appended', async () => {
  vi.useFakeTimers();
  const viewer = 'macro|viewer@example.com';
  const person = (id: string) => ({
    recordKey: `GraphqlContact:${id}`,
    userId: `macro|${id}@example.com`,
    email: `${id}@example.com`,
    name: id,
    lastInteractionMs: 0,
    matchRank: 2,
    score: 1,
    timestampMs: 0,
  });
  const search = vi
    .fn<PeopleCache['search']>()
    .mockImplementation(async (request) => ({
      kind: 'page',
      policyVersion: 5,
      people: request.cursor
        ? [person('first-b'), person('next-a'), person('next-b')]
        : [person('first-a'), person('first-b')],
      truncated: !request.cursor,
      nextCursor: request.cursor ? null : 'rank-position',
    }));
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    readQuery: async () => ({
      kind: 'hit' as const,
      data: { user: { id: viewer } },
    }),
    people: {
      ...unsupportedContactSync,
      readSql: vi
        .fn<PeopleCache['readSql']>()
        .mockResolvedValue({ kind: 'unsupported' }),
      resolveReferences: vi.fn<PeopleCache['resolveReferences']>(),
      search,
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
    },
  };
  const client = new QueryClient();
  let list: ReturnType<typeof createPersonList> | undefined;
  function Harness() {
    list = createPersonList({
      scope: () => ({ userId: viewer, host }),
      search: () => '',
      enabled: () => true,
      policy: () => ({ mode: 'command', excluded: [] }),
      activity: () => new Map(),
      conversation: () => undefined,
      excluded: () => false,
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const names = () => list?.items().map((item) => item.data.name);
  await vi.advanceTimersByTimeAsync(500);
  expect(names()).toEqual(['first-a', 'first-b']);
  const window = list?.windowKey?.();
  expect(window).toBeDefined();
  expect(list?.hasMore()).toBe(true);

  const next = list?.loadMore();
  // Nothing already listed leaves while the page loads.
  expect(names()).toEqual(['first-a', 'first-b']);
  await vi.advanceTimersByTimeAsync(500);
  await next;
  expect(names()).toEqual(['first-a', 'first-b', 'next-a', 'next-b']);
  expect(list?.items().map((item) => item.personOrder)).toEqual([0, 1, 2, 3]);
  expect(list?.windowKey?.()).toBe(window);
  expect(list?.hasMore()).toBe(false);

  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  client.clear();
});

it('lists a typed teammate first when a tab without the cache reads people from the server', async () => {
  vi.useFakeTimers();
  const viewer = 'macro|viewer@example.com';
  const contact = (email: string, name: string) => ({
    __typename: 'GraphqlContact' as const,
    id: `contact-${email}`,
    userId: `macro|${email}`,
    email,
    name,
  });
  // The server's page is in contact-ID order: three loose matches, with the
  // people named Teo past its end.
  vi.mocked(fetchContactDirectoryPage).mockResolvedValue({
    user: {
      id: viewer,
      contacts: {
        nodes: [
          contact('1teo@example.com', 'Stevie Leon'),
          contact('mateo@example.com', 'Mateo Rossi'),
          contact('otto@example.com', 'Tate Eton'),
        ],
        nextCursor: 'next',
      },
    },
  });
  // Its exact search reaches one stranger; the teammates sort beyond its scan.
  vi.mocked(fetchContactReferencePage).mockResolvedValue({
    user: {
      id: viewer,
      contacts: {
        nodes: [contact('teo.adams@example.com', 'Teo Adams')],
        nextCursor: 'more',
      },
    },
  });
  vi.mocked(fetchContactDirectoryByIds).mockResolvedValue({
    user: {
      id: viewer,
      contactsByUserIds: [
        contact('teo.nys@example.com', 'Teo Nys'),
        contact('teo.zed@example.com', 'Teo Zed'),
        contact('zoe@example.com', 'Zoe Hart'),
      ],
    },
  });
  const client = new QueryClient();
  let list: ReturnType<typeof createPersonList> | undefined;
  function Harness() {
    const [query] = createSignal('teo');
    list = createPersonList({
      // No cache host: this tab reads the server.
      scope: () => ({ userId: viewer }),
      search: query,
      enabled: () => true,
      policy: () => ({ mode: 'mention', excluded: [] }),
      activity: () =>
        new Map([['macro|teo.zed@example.com', '2026-03-01T00:00:00Z']]),
      teammates: () =>
        new Set([
          'macro|teo.nys@example.com',
          'macro|teo.zed@example.com',
          'macro|zoe@example.com',
        ]),
      conversation: () => undefined,
      excluded: () => false,
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  expect(list?.items().map((item) => item.data.name)).toEqual([
    // The teammate the viewer messages, the teammate they never did, then the
    // stranger with the same first name; the server's loose matches follow.
    'Teo Zed',
    'Teo Nys',
    'Teo Adams',
    'Stevie Leon',
    'Mateo Rossi',
    'Tate Eton',
  ]);
  expect(list?.items().map((item) => item.personOrder)).toEqual([
    0, 1, 2, 3, 4, 5,
  ]);
  expect(fetchContactDirectoryByIds).toHaveBeenCalledWith(
    [
      'macro|teo.nys@example.com',
      'macro|teo.zed@example.com',
      'macro|zoe@example.com',
    ],
    expect.anything()
  );

  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  client.clear();
});

it('keeps the order of a server page read for a late cache only when the page ranked the people its text names', async () => {
  vi.useFakeTimers();
  const viewer = 'macro|viewer@example.com';
  const contact = (email: string, name: string) => ({
    __typename: 'GraphqlContact' as const,
    id: `contact-${email}`,
    userId: `macro|${email}`,
    email,
    name,
  });
  vi.mocked(fetchContactDirectoryPage).mockResolvedValue({
    user: {
      id: viewer,
      contacts: {
        nodes: [
          contact('mateo@example.com', 'Mateo Rossi'),
          contact('teo.nys@example.com', 'Teo Nys'),
        ],
        nextCursor: null,
      },
    },
  });
  vi.mocked(fetchContactReferencePage).mockResolvedValue({
    user: { id: viewer, contacts: { nodes: [], nextCursor: null } },
  });
  vi.mocked(fetchContactDirectoryByIds).mockResolvedValue({
    user: { id: viewer, contactsByUserIds: [] },
  });
  // A cache that never answers: after the budget the server lists the people.
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    readQuery: () => new Promise<never>(() => {}),
    people: {
      ...unsupportedContactSync,
      readSql: vi
        .fn<PeopleCache['readSql']>()
        .mockResolvedValue({ kind: 'unsupported' }),
      resolveReferences: vi.fn<PeopleCache['resolveReferences']>(),
      search: vi.fn<PeopleCache['search']>(),
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
    },
  };
  const client = new QueryClient();
  const [query, setQuery] = createSignal('');
  let list: ReturnType<typeof createPersonList> | undefined;
  function Harness() {
    list = createPersonList({
      scope: () => ({ userId: viewer, host }),
      search: query,
      enabled: () => true,
      localBudgetMs: 2_000,
      policy: () => ({ mode: 'mention', excluded: [] }),
      activity: () => new Map(),
      teammates: () => new Set(['macro|teo.nys@example.com']),
      conversation: () => undefined,
      excluded: () => false,
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));

  // Browsing: the server's order means nothing, so the rows carry none.
  await vi.advanceTimersByTimeAsync(2_000);
  expect(list?.items().map((item) => item.data.name)).toEqual([
    'Mateo Rossi',
    'Teo Nys',
  ]);
  expect(list?.items().map((item) => item.personOrder)).toEqual([
    undefined,
    undefined,
  ]);

  // A typed search: the page ranked the person the text names, and that
  // order is the window's.
  setQuery('teo');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(list?.items().map((item) => item.data.name)).toEqual([
    'Teo Nys',
    'Mateo Rossi',
  ]);
  expect(list?.items().map((item) => item.personOrder)).toEqual([0, 1]);

  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  client.clear();
});
