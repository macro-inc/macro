import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useSavedViews } from './saved-views';

const list = vi.hoisted(() => ({
  data: undefined,
  error: null as Error | null,
  isPending: true,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: async () => {},
  refetch: async () => {},
}));

vi.mock('@app/lib/urql-solid/create-urql-infinite-query', () => ({
  createUrqlInfiniteQuery: () => list,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));
vi.mock('./saved-view-changes', () => ({
  refreshOnSavedViewChanges: () => {},
}));

describe('useSavedViews', () => {
  it('stops loading once the first page fails', () => {
    list.isPending = false;
    list.error = new Error('network');
    createRoot((dispose) => {
      const views = useSavedViews({ viewerId: () => 'viewer', kind: 'email' });
      expect(views.error()).toBe(list.error);
      expect(views.loading()).toBe(false);
      dispose();
    });
  });
});
