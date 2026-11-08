import { createComputed, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SoupAstItemsQuery, SoupAstItemsQueryArgs } from '../soup/items';

const compileToAstMock = vi.hoisted(() => vi.fn());
const queryState = vi.hoisted(() => ({
  queries: [] as Array<{
    args: () => SoupAstItemsQueryArgs;
    query: SoupAstItemsQuery;
    setData: (ids: readonly string[]) => void;
    setPending: (pending: boolean) => void;
  }>,
}));

vi.mock('@app/features/next-soup/filters/filter-store', () => ({
  compileToAst: compileToAstMock,
  defineQueryFilters: (filters: unknown) => filters,
  queryStateFrom: (filters: unknown) => filters,
}));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('./register-notification-refresh', () => ({
  registerChannelNotificationRefresh: () => () => {},
}));
vi.mock('../soup/items', async () => {
  const { createSignal } = await import('solid-js');
  return {
    useSoupAstItemsQuery: (args: () => SoupAstItemsQueryArgs) => {
      const [data, setData] = createSignal<readonly string[]>([]);
      const [pending, setPending] = createSignal(true);
      const query = {
        get data() {
          return {
            entities: data().map((id) => ({ id, type: 'channel' })),
          };
        },
        get isPending() {
          return pending();
        },
        isEnabled: false,
        isFetching: false,
        hasNextPage: false,
        error: null,
        fetchError: null,
        transport: 'graphql',
        refresh: async () => {},
        fetchNextPage: async () => {},
      } as unknown as SoupAstItemsQuery;
      queryState.queries.push({ args, query, setData, setPending });
      return query;
    },
  };
});

import { useCachedChannelsByIds, useChannelsByIdsQuery } from './by-ids';

const cleanups: Array<() => void> = [];
beforeEach(() => {
  queryState.queries = [];
  compileToAstMock.mockReset();
  compileToAstMock.mockImplementation((state) => ({ state }));
});
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
});

it('compiles each distinct ID set once, however many readers its arguments have', () => {
  const [ids, setIds] = createSignal<readonly string[]>(['a', 'b']);
  createRoot((dispose) => {
    cleanups.push(dispose);
    useChannelsByIdsQuery(ids);
  });
  const { args } = queryState.queries[0];
  createRoot((dispose) => {
    cleanups.push(dispose);
    for (let reader = 0; reader < 8; reader++) createComputed(() => args());
  });
  expect(compileToAstMock).toHaveBeenCalledTimes(1);

  setIds(['a', 'b']);
  expect(compileToAstMock).toHaveBeenCalledTimes(1);

  setIds(['a', 'c']);
  expect(compileToAstMock).toHaveBeenCalledTimes(2);
  expect(args().body).toBeDefined();
});

it('keeps resolved, pending and failed ID sets stable across reads', () => {
  const resolved = createRoot((dispose) => {
    cleanups.push(dispose);
    return useCachedChannelsByIds(
      () => ['a', 'b', 'c'],
      () => true
    );
  });
  const batch = queryState.queries[0];
  const pending = resolved.pendingIds();
  expect([...pending].sort()).toEqual(['a', 'b', 'c']);
  expect(resolved.pendingIds()).toBe(pending);
  expect(resolved.failedIds()).toBe(resolved.failedIds());

  batch.setData(['a']);
  batch.setPending(false);
  const channels = resolved.channels();
  expect(channels.map((channel) => channel.id)).toEqual(['a']);
  expect(resolved.channels()).toBe(channels);
  expect(resolved.pendingIds().size).toBe(0);
});
