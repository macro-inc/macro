import { throwOnErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import type { SoupPage } from '@service-storage/generated/schemas/soupPage';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { getSoupEntityById, getSoupItemId } from './normalized-cache';
import { soupKeys } from './keys';
import type { SoupItemsQueryArgs } from './items';

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
    queryFn: async () => {
      return throwOnErr(
        async () =>
          await storageServiceClient.getSoupItems({
            params: {},
            body: {
              ...recentlyViewedArgs.body,
              ...recentlyViewedArgs.params,
            },
          })
      );
    },
    staleTime: RECENTLY_VIEWED_STALE_TIME,
    gcTime: RECENTLY_VIEWED_GC_TIME,
    placeholderData: (prev: any) => prev,
    meta: { normalize: true },
  }));
}

export function ensureItemInRecentlyViewed(itemId: string) {
  queryClient.setQueryData<SoupPage>(recentlyViewedQueryKey, (prev) => {
    if (!prev) return prev;

    const alreadyPresent = prev.items.some(
      (item) => getSoupItemId(item) === itemId
    );
    if (alreadyPresent) return prev;

    const soupEntity = getSoupEntityById(itemId);
    if (!soupEntity) return prev;

    return {
      ...prev,
      items: [soupEntity, ...prev.items.slice(0, RECENTLY_VIEWED_LIMIT - 1)],
    };
  });

  const data = queryClient.getQueryData<SoupPage>(recentlyViewedQueryKey);
  if (data && !data.items.some((item) => getSoupItemId(item) === itemId)) {
    queryClient.invalidateQueries({ queryKey: recentlyViewedQueryKey });
  }
}
