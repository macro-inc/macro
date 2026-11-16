import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheChangeListener, CacheHost } from '@graphql-cache/host/types';
import { PEOPLE_POLICY_VERSION } from '@graphql-cache/people/generated';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { cleanup, render } from '@solidjs/testing-library';
import {
  hashKey,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { CombinedError } from '@urql/core';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContactDirectoryPage, readContactDirectory } from './directory';
import { createContactDirectoryWindow } from './directory-query';

vi.mock('./backfill', () => ({
  loadContactCheckpoint: () => ({ pages: 200, completedAt: 1 }),
}));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(['query', 'policy'] as const)(
  'does not revive a continuation when an external %s returns to its earlier value',
  async (change) => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const [term, setTerm] = createSignal('alpha');
    const [excluded, setExcluded] = createSignal<string[]>([]);
    let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
    let committed = Promise.withResolvers<void>();
    const reader = vi.fn<typeof readContactDirectory>().mockImplementation(
      async (user, _host, request): Promise<ContactDirectoryPage> => ({
        source: 'cache',
        sync: 'snapshot',
        offline: false,
        query: request.query,
        users: [
          {
            id: 'macro|person@example.com',
            email: 'person@example.com',
            name: request.cursor ? 'page two' : 'page one',
          },
        ],
        nextCursor: {
          source: 'people',
          userId: user,
          query: request.query,
          generation: 'db',
          after: 'page-two-cursor',
          policyKey: hashKey([request.policy]),
        },
      })
    );
    function Harness() {
      const directory = createContactDirectoryWindow(
        () => ({ userId: 'macro|viewer@example.com' }),
        reader,
        () => true,
        {
          search: term,
          policy: () => ({ mode: 'command', excluded: excluded() }),
        }
      );
      window = directory;
      createEffect(() => {
        if (directory.data()) committed.resolve();
      });
      return null;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ));
    await vi.advanceTimersByTimeAsync(200);
    await committed.promise;
    committed = Promise.withResolvers<void>();
    window!.next();
    await vi.runOnlyPendingTimersAsync();
    await committed.promise;
    expect(window!.data()?.users[0].name).toBe('page two');
    committed = Promise.withResolvers<void>();
    if (change === 'query') setTerm('beta');
    else setExcluded(['macro|viewer@example.com']);
    await vi.advanceTimersByTimeAsync(200);
    await committed.promise;
    expect(window!.data()?.users[0].name).toBe('page one');
    committed = Promise.withResolvers<void>();
    if (change === 'query') setTerm('alpha');
    else setExcluded([]);
    await vi.advanceTimersByTimeAsync(200);
    await committed.promise;
    expect(reader.mock.calls.at(-1)?.[2].cursor).toBeUndefined();
    expect(window!.data()?.users[0].name).toBe('page one');
    client.clear();
  }
);

it('recovers an initially unavailable offline picker after context publication', async () => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let ready = false;
  let changed: CacheChangeListener | undefined;
  const search = vi.fn(async () =>
    ready
      ? {
          kind: 'page' as const,
          policyVersion: PEOPLE_POLICY_VERSION,
          truncated: false,
          nextCursor: null,
          people: [
            {
              recordKey: 'GraphqlContact:test',
              userId: 'macro|person@example.com',
              email: 'person@example.com',
              name: 'Person',
              matchRank: 0,
              score: 0,
              timestampMs: 0,
            },
          ],
        }
      : { kind: 'contextPending' as const }
  );
  const host: CacheHost = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    readQuery: async () => ({
      kind: 'hit',
      data: { user: { id: 'macro|viewer@example.com' } },
    }),
    onCacheChanged: (callback) => {
      changed = callback;
      return () => {};
    },
    people: {
      ...unsupportedContactSync,
      readSql: async () => ({ kind: 'unsupported' }),
      resolveReferences: async () => ({ kind: 'unsupported' }),
      search,
      context: async () => ({ kind: 'missing' }),
      update: async () => parseCacheRevision('1'),
    },
  };
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  function Harness() {
    window = createContactDirectoryWindow(
      () => ({ userId: 'macro|viewer@example.com', host }),
      undefined,
      () => true,
      { policy: () => ({ mode: 'command', excluded: [] }) }
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(200);
  expect(window!.error()).toBeDefined();
  ready = true;
  changed!(parseCacheRevision('2'), { searchChangedBuckets: ['person'] });
  await vi.advanceTimersByTimeAsync(300);
  expect(search).toHaveBeenCalledTimes(2);
  expect(window!.data()?.users).toHaveLength(1);
  client.clear();
});

it('does not retry authorization failures, but hydration refreshes a recovered local page', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const client = new QueryClient();
  let changed: CacheChangeListener | undefined;
  const host: CacheHost = {
    ...createNoopCacheHost(),
    disabled: false,
    onCacheChanged: (callback) => {
      changed = callback;
      return () => {};
    },
  };
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockRejectedValue(new CombinedError({ graphQLErrors: ['Forbidden'] }));
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  function Harness() {
    window = createContactDirectoryWindow(
      () => ({ userId: 'viewer', host }),
      reader
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(200);
  changed!(parseCacheRevision('1'), { searchChangedBuckets: ['person'] });
  await vi.advanceTimersByTimeAsync(300);
  expect(reader).toHaveBeenCalledOnce();
  reader.mockResolvedValue({
    source: 'cache',
    sync: 'partial',
    offline: false,
    query: '',
    users: [],
    nextCursor: {
      source: 'people',
      generation: 'fixture',
      policyKey: '',
      userId: 'viewer',
      query: '',
      after: 'page-two',
    },
  });
  await window!.retry();
  changed!(parseCacheRevision('2'), { searchChangedBuckets: ['person'] });
  await vi.advanceTimersByTimeAsync(300);
  expect(reader).toHaveBeenCalledTimes(3);
  expect(window!.data()?.source).toBe('cache');
  client.clear();
});

it('keeps its window key through a refresh of the same page and changes it for the next page', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const client = new QueryClient();
  let changed: CacheChangeListener | undefined;
  const host: CacheHost = {
    ...createNoopCacheHost(),
    disabled: false,
    onCacheChanged: (callback) => {
      changed = callback;
      return () => {};
    },
  };
  const reader = vi.fn<typeof readContactDirectory>().mockImplementation(
    async (user, _host, request): Promise<ContactDirectoryPage> => ({
      source: 'cache',
      sync: 'snapshot',
      offline: false,
      query: request.query,
      users: [],
      nextCursor: request.cursor
        ? null
        : {
            source: 'people',
            userId: user,
            query: request.query,
            generation: 'db',
            after: 'page-two-cursor',
            policyKey: hashKey([request.policy]),
          },
    })
  );
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  function Harness() {
    window = createContactDirectoryWindow(
      () => ({ userId: 'viewer', host }),
      reader
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(300);
  const firstPage = window!.windowKey();
  expect(firstPage).toBeDefined();

  changed!(parseCacheRevision('1'), { searchChangedBuckets: ['person'] });
  await vi.advanceTimersByTimeAsync(300);
  expect(reader).toHaveBeenCalledTimes(2);
  expect(window!.windowKey()).toBe(firstPage);

  await window!.loadNext();
  await vi.advanceTimersByTimeAsync(300);
  expect(window!.windowKey()).toBeDefined();
  expect(window!.windowKey()).not.toBe(firstPage);
  client.clear();
});
