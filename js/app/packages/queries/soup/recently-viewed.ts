import { throwOnErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
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
