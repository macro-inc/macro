import { throwOnErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { soupKeys } from './keys';
import type { SoupItemsQueryArgs } from './items';

// NOTE: we only use this for merging viewedAt into history items.
// This narrower type makes optimistic updates simpler if the item is not already in the normy cache.
type RecentlyViewedItem = {
  id: string;
  viewedAt: string | undefined;
};

const RECENTLY_VIEWED_LIMIT = 50;
const RECENTLY_VIEWED_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const RECENTLY_VIEWED_GC_TIME = 10 * 60 * 1000; // 10 minutes

const recentlyViewedArgs: SoupItemsQueryArgs = {
  params: { sort_method: 'viewed_at', limit: RECENTLY_VIEWED_LIMIT },
  body: {
    call_filters: {
      channel_ids: ['00000000-0000-0000-0000-000000000000'],
    },
  },
};

const recentlyViewedQueryKey = soupKeys.items(recentlyViewedArgs).queryKey;

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
      return page.items
        .filter((item) => item.tag !== 'callRecord')
        .map((item) => ({
          id: item.tag === 'channel' ? item.data.channel.id : item.data.id,
          viewedAt:
            (item.tag === 'channel'
              ? item.data.viewed_at
              : item.data.viewedAt) ?? undefined,
        }));
    },
    staleTime: RECENTLY_VIEWED_STALE_TIME,
    gcTime: RECENTLY_VIEWED_GC_TIME,
    placeholderData: (prev) => prev,
  }));
}

export function updateRecentlyViewedItem(itemId: string, viewedAt?: string) {
  queryClient.setQueryData<RecentlyViewedItem[]>(
    recentlyViewedQueryKey,
    (prev) => {
      const filtered = prev?.filter((item) => item.id !== itemId) ?? [];
      const updatedItem = {
        id: itemId,
        viewedAt: viewedAt ?? new Date().toISOString(),
      };
      return [updatedItem, ...filtered.slice(0, RECENTLY_VIEWED_LIMIT - 1)];
    }
  );
}
