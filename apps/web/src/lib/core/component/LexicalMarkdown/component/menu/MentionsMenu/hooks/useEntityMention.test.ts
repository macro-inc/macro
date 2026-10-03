import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useEntityMention } from './useEntityMention';

const list = vi.hoisted(() => ({
  items: () => [],
  totalCount: () => 50,
  hasMore: () => true,
  isLoading: () => false,
  isLoadingMore: () => true,
  loadMore: vi.fn(),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => list,
    usesRecordSelection: () => false,
    usesSearchProjection: () => true,
    isLoading: () => false,
  }),
}));

it('exposes pagination from search projections, not just legacy record selection', async () => {
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEntityMention({ buckets: ['note'], searchTerm: () => '' }),
    dispose,
  }));
  expect(mention.hasMore()).toBe(true);
  expect(mention.isLoadingMore()).toBe(true);
  await mention.loadMore();
  expect(list.loadMore).toHaveBeenCalledOnce();
  dispose();
});
