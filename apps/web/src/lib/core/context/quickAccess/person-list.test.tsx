import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheChangeListener } from '@graphql-cache/host/types';
import type { PeopleCache } from '@graphql-cache/people/host';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createPersonList } from './person-list';

vi.mock('@queries/contacts/backfill', () => ({
  loadContactCheckpoint: () => ({ pages: 200, completedAt: 1 }),
}));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
}));
afterEach(() => vi.useRealTimers());

it('replaces ranked windows, forwards queries, excludes inboxes and retains no query/name history', async () => {
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
      // Property pickers page a replaceable window.
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

  // A contact change re-reads the page without emptying it.
  changed?.(parseCacheRevision('2'), { searchChangedBuckets: ['person'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(names()).toEqual(['Jacob Adams', 'Jacob Baker']);
  await vi.advanceTimersByTimeAsync(1000);
  expect(names()).toEqual(['Jacob Adams', 'Jacob Baker']);
  expect(search.mock.calls.length).toBeGreaterThan(2);

  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  client.clear();
  vi.restoreAllMocks();
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
