import { fireAndForget } from '@core/util/fireAndForget';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { PeopleCache } from '@graphql-cache/people/host';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import {
  createEffect,
  createMemo,
  createSignal,
  type ParentProps,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useQuickAccess } from './context';
import { createPersonList } from './person-list';
import { QuickAccessProvider } from './QuickAccessProvider';
import type { QuickAccessListOptions } from './types';

const VIEWER = 'macro|viewer@example.com';
const state = vi.hoisted(() => ({
  built: 0,
  host: undefined as unknown,
}));

vi.mock('@queries/contacts/backfill', () => ({
  loadContactCheckpoint: () => ({ pages: 200, completedAt: 1 }),
}));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
}));
vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => () => true,
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@channel/DebugSuspense', () => ({
  DebugSuspense: (props: ParentProps) => props.children,
}));
vi.mock('./QuickAccessSource', () => ({
  createQuickAccessValue: () => ({
    useList: (options: QuickAccessListOptions) => {
      state.built++;
      return createPersonList({
        scope: () => ({
          userId: 'macro|viewer@example.com',
          host: state.host as never,
        }),
        search: () => options.searchTerm?.() ?? '',
        enabled: () => options.enabled?.() !== false,
        policy: () => ({ mode: 'command', excluded: [] }),
        activity: () => new Map(),
        conversation: () => undefined,
        excluded: () => false,
      });
    },
    usesRecordSelection: () => true,
    usesSearchProjection: () => true,
    isLoading: () => false,
    refresh: () => {},
    getById: () => undefined,
    interactionForUser: () => undefined,
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  state.built = 0;
});

it('keeps one list through typing and lists the next page of people below the first', async () => {
  vi.useFakeTimers();
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
            name: id,
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
  state.host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    readQuery: async () => ({
      kind: 'hit' as const,
      data: { user: { id: VIEWER } },
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
  const [paging, setPaging] = createSignal(false);
  let ids: () => string[] = () => [];
  let pageRequests = 0;
  // The command menu builds its list in a memo and asks for the next page
  // whenever one exists and none is loading.
  function Menu() {
    const quickAccess = useQuickAccess();
    const list = createMemo(() =>
      quickAccess.useList({
        buckets: ['person'],
        searchTerm: query,
        peopleMode: 'command',
      })
    );
    ids = () =>
      list()
        .items()
        .map((item) => item.id);
    createEffect(() => {
      if (!paging() || !list().hasMore() || list().isLoadingMore()) return;
      if (++pageRequests > 20) return;
      fireAndForget(list().loadMore(), 'test');
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <QuickAccessProvider>
        <Menu />
      </QuickAccessProvider>
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(1000);
  expect(ids()).toEqual(['macro|first@example.com']);

  setQuery('a');
  await vi.advanceTimersByTimeAsync(1000);
  setQuery('al');
  await vi.advanceTimersByTimeAsync(1000);
  expect(ids()).toEqual(['macro|first@example.com']);
  expect(state.built).toBe(1);

  setPaging(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(ids()).toEqual(['macro|first@example.com', 'macro|next@example.com']);
  expect(pageRequests).toBe(1);
  expect(state.built).toBe(1);

  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  client.clear();
});
