import { throwOnErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { getSoupItemId } from './normalized-cache';
import { soupKeys } from './keys';
import type { SoupItemsQueryArgs } from './items';

// NOTE: we only use this for merging viewedAt into history items.
// This narrower type makes optimistic updates simpler if the item is not already in the normy cache.
export type RecentlyViewedItem = {
  id: string;
  viewedAt: string | undefined;
};

const RECENTLY_VIEWED_LIMIT = 50;
const RECENTLY_VIEWED_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const RECENTLY_VIEWED_GC_TIME = 10 * 60 * 1000; // 10 minutes

const recentlyViewedArgs: SoupItemsQueryArgs = {
  params: { sort_method: 'viewed_at', limit: RECENTLY_VIEWED_LIMIT },
  body: {},
};

export const recentlyViewedQueryKey =
  soupKeys.items(recentlyViewedArgs).queryKey;

export function useRecentlyViewedSoupQuery() {
  return useQuery(() => ({
    queryKey: recentlyViewedQueryKey,
    queryFn: async (): Promise<RecentlyViewedItem[]> => {
      const page = await throwOnErr(
        async () =>
          await storageServiceClient.getSoupItems({
            params: {},
            body: {
              ...recentlyViewedArgs.body,
              ...recentlyViewedArgs.params,
            },
          })
      );
      return page.items.map((item) => ({
        id: getSoupItemId(item),
        viewedAt:
          (item.tag === 'channel' ? item.data.viewed_at : item.data.viewedAt) ??
          undefined,
      }));
    },
    staleTime: RECENTLY_VIEWED_STALE_TIME,
    gcTime: RECENTLY_VIEWED_GC_TIME,
    placeholderData: (prev) => prev,
  }));
}

export function ensureItemInRecentlyViewed(itemId: string) {
  queryClient.setQueryData<RecentlyViewedItem[]>(
    recentlyViewedQueryKey,
    (prev) => {
      if (!prev) return prev;
      if (prev.some((item) => item.id === itemId)) return prev;
      return [
        { id: itemId, viewedAt: new Date().toISOString() },
        ...prev.slice(0, RECENTLY_VIEWED_LIMIT - 1),
      ];
    }
  );
}
