import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/solid-query';
import { queryClient } from '../client';
import { fetchGraphqlSoupPage } from './graphql/fetch-page';
import type { SoupAstItemsQueryArgs } from './items';
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

/**
 * Channels, chats, agent sessions, documents, email, folders and CRM
 * companies, most recently viewed first.
 */
export const RECENTLY_VIEWED_ARGS: SoupAstItemsQueryArgs = {
  params: { sort_method: 'viewed_at', limit: RECENTLY_VIEWED_LIMIT },
  body: compileToAst(
    queryStateFrom(
      defineQueryFilters(
        { include: { includeAgentSessions: true } },
        { skipTargets: ['chanf', 'cf', 'df', 'ef', 'pf', 'ccf'] }
      )
    )
  ),
};

function recentlyViewedQueryKey() {
  return soupKeys.items(RECENTLY_VIEWED_ARGS).queryKey;
}

async function fetchRecentlyViewed(
  args: SoupAstItemsQueryArgs
): Promise<RecentlyViewedItem[]> {
  const page = await fetchGraphqlSoupPage(args, {
    requestPolicy: 'network-only',
  });
  return page.items.flatMap((item): RecentlyViewedItem[] => {
    // Reminders have no `viewedAt` — they are never "viewed", only fired.
    if (
      item.tag === 'call' ||
      item.tag === 'foreignEntity' ||
      item.tag === 'channelThread' ||
      item.tag === 'calendarEvent' ||
      item.tag === 'databaseRow' ||
      item.tag === 'harness' ||
      item.tag === 'team'
    ) {
      return [];
    }

    return [
      {
        id: item.tag === 'channel' ? item.data.channel.id : item.data.id,
        viewedAt:
          (item.tag === 'channel' ? item.data.viewed_at : item.data.viewedAt) ??
          undefined,
      },
    ];
  });
}

// Cached callbacks outlive the caller; only the plain request enters here.
function recentlyViewedQueryOptions(args: SoupAstItemsQueryArgs) {
  return queryOptions({
    queryKey: soupKeys.items(args).queryKey,
    queryFn: () => fetchRecentlyViewed(args),
    staleTime: RECENTLY_VIEWED_STALE_TIME,
    gcTime: RECENTLY_VIEWED_GC_TIME,
    placeholderData: keepPreviousData,
  });
}

export function useRecentlyViewedSoupQuery() {
  return useQuery(() => recentlyViewedQueryOptions(RECENTLY_VIEWED_ARGS));
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
