import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { enableCrm, isFeatureEnabled } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import type { SoupItemsQueryArgs } from './items';
import { soupKeys } from './keys';

// NOTE: we only use this for merging viewedAt into history items.
// This narrower type makes optimistic updates simpler if the item is not already in the normy cache.
type RecentlyViewedItem = {
  id: string;
  viewedAt: string | undefined;
};

const RECENTLY_VIEWED_LIMIT = 50;
const RECENTLY_VIEWED_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const RECENTLY_VIEWED_GC_TIME = 10 * 60 * 1000; // 10 minutes

// Built at call time (not module load) so the CRM flag is read after PostHog
// has hydrated. The flag is stable within a session, so the derived query key
// is stable too — the hook and `updateRecentlyViewedItem` agree on it.
function buildRecentlyViewedArgs(): SoupItemsQueryArgs {
  return {
    params: { sort_method: 'viewed_at', limit: RECENTLY_VIEWED_LIMIT },
    body: {
      ...QUERY_FILTERS_BASE,
      channel_filters: undefined,
      chat_filters: undefined,
      document_filters: undefined,
      email_filters: undefined,
      project_filters: undefined,
      // CRM companies only surface in recently-viewed when the feature is enabled.
      ...(isFeatureEnabled(enableCrm)
        ? { crm_company_filters: undefined }
        : {}),
    },
  };
}

function recentlyViewedQueryKey() {
  return soupKeys.items(buildRecentlyViewedArgs()).queryKey;
}

export function useRecentlyViewedSoupQuery() {
  return useQuery(() => {
    const args = buildRecentlyViewedArgs();
    return {
      queryKey: soupKeys.items(args).queryKey,
      queryFn: async (): Promise<RecentlyViewedItem[]> => {
        const page = await throwOnErr(
          async () =>
            await storageServiceClient.getSoupItems({
              params: {},
              body: {
                ...args.body,
                ...args.params,
              },
            })
        );
        return page.items.flatMap((item): RecentlyViewedItem[] => {
          // Reminders have no `viewedAt` — they are never "viewed", only fired.
          if (
            item.tag === 'call' ||
            item.tag === 'foreignEntity' ||
            item.tag === 'channelThread' ||
            item.tag === 'calendarEvent' ||
            item.tag === 'reminder'
          ) {
            return [];
          }

          return [
            {
              id: item.tag === 'channel' ? item.data.channel.id : item.data.id,
              viewedAt:
                (item.tag === 'channel'
                  ? item.data.viewed_at
                  : item.data.viewedAt) ?? undefined,
            },
          ];
        });
      },
      staleTime: RECENTLY_VIEWED_STALE_TIME,
      gcTime: RECENTLY_VIEWED_GC_TIME,
      placeholderData: (prev) => prev,
    };
  });
}

export function updateRecentlyViewedItem(itemId: string, viewedAt?: string) {
  queryClient.setQueryData<RecentlyViewedItem[]>(
    recentlyViewedQueryKey(),
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
