import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { PeopleCache } from '@graphql-cache/people/host';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
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
      policy: () => ({ mode: 'command', excluded: [viewer] }),
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
