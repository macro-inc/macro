import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { type EntityItem, useQuickAccess } from '@core/context/quickAccess';
import { createFreshSearch } from '@core/util/freshSort';
import {
  type SearchSoupQueryArgs,
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';

const USE_QUICK_ACCESS_FOR_EMAIL_MENTIONS: boolean = false;

type UseEmailSearchMentionOptions = {
  searchTerm: Accessor<string>;
  enabled?: Accessor<boolean | undefined>;
  /**
   * List recent threads while the term is too short for the search service.
   * Set for menus that offer only emails, which would otherwise be empty.
   */
  recentWhenShort?: Accessor<boolean>;
};

type UseEmailSearchMentionResult = {
  emails: Accessor<EntityItem[]>;
  totalCount: Accessor<number>;
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
};

/**
 * Provides email mentions through unified search by default. Quick Access
 * supplies them behind USE_QUICK_ACCESS_FOR_EMAIL_MENTIONS, and for
 * `recentWhenShort` menus while the term is too short to search.
 */
export function useEmailSearchMention(
  options: UseEmailSearchMentionOptions
): UseEmailSearchMentionResult {
  const { searchTerm, enabled } = options;
  const listEnabled = () => enabled?.() !== false;
  const quickAccess = useQuickAccess();
  const usesQuickAccess = () =>
    (USE_QUICK_ACCESS_FOR_EMAIL_MENTIONS &&
      quickAccess.usesRecordSelection()) ||
    (options.recentWhenShort?.() === true &&
      !validateSearchServiceText(searchTerm().trim()));
  const cachedEmails = quickAccess.useList({
    buckets: ['email'],
    searchTerm,
    enabled: () => usesQuickAccess() && listEnabled(),
  });

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

  // Nothing tells a viewer they lost access, so each search asks again when shown.
  const emailSearchQuery = useSearchSoupQuery(args, () => ({
    enabled: !usesQuickAccess() && listEnabled(),
    staleTime: 0,
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
    // Drafts, local ones included, are not threads a mention can point to.
    if (usesQuickAccess())
      return cachedEmails.items().filter((item) => !item.data.isDraft);

    const term = searchTerm();
    const remoteEmails = remoteEmailList();
    if (!term) return remoteEmails;
    return emailSearch(remoteEmails, term).map(({ item }) => item);
  });

  return {
    emails,
    totalCount: () =>
      usesQuickAccess()
        ? cachedEmails.totalCount() -
          (cachedEmails.items().length - emails().length)
        : emails().length,
    hasMore: () =>
      usesQuickAccess()
        ? cachedEmails.hasMore()
        : Boolean(emailSearchQuery.hasNextPage),
    isLoadingMore: () =>
      usesQuickAccess()
        ? cachedEmails.isLoadingMore()
        : emailSearchQuery.isFetching,
    loadMore: async () => {
      if (usesQuickAccess()) {
        await cachedEmails.loadMore();
      } else if (emailSearchQuery.hasNextPage) {
        await emailSearchQuery.fetchNextPage();
      }
    },
  };
}
