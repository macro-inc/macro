import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { type EntityItem, useQuickAccess } from '@core/context/quickAccess';
import { createFreshSearch } from '@core/util/freshSort';
import {
  type SearchSoupQueryArgs,
  useSearchSoupQuery,
} from '@queries/soup/search';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';

type UseEmailSearchMentionOptions = {
  searchTerm: Accessor<string>;
  enabled?: Accessor<boolean | undefined>;
};

type UseEmailSearchMentionResult = {
  emails: Accessor<EntityItem[]>;
  totalCount: Accessor<number>;
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
};

/**
 * Provides cache-backed email mentions for the record-selection source and
 * preserves the remote unified-search path for the legacy source.
 */
export function useEmailSearchMention(
  options: UseEmailSearchMentionOptions
): UseEmailSearchMentionResult {
  const { searchTerm, enabled } = options;
  const listEnabled = () => enabled?.() !== false;
  const quickAccess = useQuickAccess();
  const cachedEmails = quickAccess.useList({
    buckets: ['email'],
    searchTerm,
    enabled: listEnabled,
  });
  const usesRecordSelection = quickAccess.usesRecordSelection;

  const args = createLazyMemo((): SearchSoupQueryArgs => {
    return {
      params: {
        cursor: null,
        page_size: 10,
      },
      body: {
        match_type: 'partial',
        search_on: 'name',
        query: searchTerm(),
        filters: {
          ...QUERY_FILTERS_BASE,
          email_filters: undefined,
        },
      },
    };
  });

  const emailSearchQuery = useSearchSoupQuery(args, () => ({
    enabled: !usesRecordSelection() && listEnabled(),
  }));

  const remoteEmailList = createLazyMemo((): EntityItem[] => {
    if (emailSearchQuery.status !== 'success') return [];
    return emailSearchQuery.data
      .filter((e) => e.type === 'email')
      .map(
        (e): EntityItem => ({
          kind: 'entity',
          id: e.id,
          bucket: 'email',
          searchText: e.name ?? 'No Subject',
          sortTimestamp: e.updatedAt ? new Date(e.updatedAt).getTime() : 0,
          timestamps: {
            updatedAt: e.updatedAt ?? null,
            createdAt: e.createdAt ?? null,
          },
          data: e as unknown as EntityItem['data'],
        })
      );
  });

  const emailSearch = createFreshSearch<EntityItem>({
    config: { timeWeight: 0, brevityWeight: 0.3 },
    getName: (item) => item.searchText,
    getTimestamp: (item) => item.timestamps,
  });

  const emails = createLazyMemo((): EntityItem[] => {
    if (usesRecordSelection()) return cachedEmails.items();

    const term = searchTerm();
    const remoteEmails = remoteEmailList();
    if (!term) return remoteEmails;
    return emailSearch(remoteEmails, term).map(({ item }) => item);
  });

  return {
    emails,
    totalCount: () =>
      usesRecordSelection() ? cachedEmails.totalCount() : emails().length,
    hasMore: () =>
      usesRecordSelection()
        ? cachedEmails.hasMore()
        : Boolean(emailSearchQuery.hasNextPage),
    isLoadingMore: () =>
      usesRecordSelection()
        ? cachedEmails.isLoadingMore()
        : emailSearchQuery.isFetching,
    loadMore: async () => {
      if (usesRecordSelection()) {
        await cachedEmails.loadMore();
      } else if (emailSearchQuery.hasNextPage) {
        await emailSearchQuery.fetchNextPage();
      }
    },
  };
}
