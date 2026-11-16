import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { type EntityItem, useQuickAccess } from '@core/context/quickAccess';
import { createFreshSearch } from '@core/util/freshSort';
import type { EmailEntity, EntityData } from '@entity';
import {
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import {
  type SearchSoupQueryArgs,
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';

const USE_QUICK_ACCESS_FOR_EMAIL_MENTIONS: boolean = false;

/** The viewer's newest threads, for when Quick Access holds no emails. */
const RECENT_EMAIL_THREADS_ARGS: SoupItemsQueryArgs = {
  params: { limit: 20, sort_method: 'updated_at' },
  body: { ...QUERY_FILTERS_BASE, email_filters: {} },
};

function emailEntityItem(email: EntityData): EntityItem {
  return {
    kind: 'entity',
    id: email.id,
    bucket: 'email',
    searchText: email.name ?? 'No Subject',
    sortTimestamp: email.updatedAt ? new Date(email.updatedAt).getTime() : 0,
    timestamps: {
      updatedAt: email.updatedAt ?? null,
      createdAt: email.createdAt ?? null,
    },
    data: email as unknown as EntityItem['data'],
  };
}

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
 * `recentWhenShort` menus while the term is too short to search; when it has
 * no threads (its email bucket needs the GraphQL cache), the newest threads
 * come from the REST Soup list instead.
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
  // Drafts, local ones included, are not threads a mention can point to.
  const cachedThreads = createLazyMemo(() =>
    cachedEmails.items().filter((item) => !item.data.isDraft)
  );
  // Whether Quick Access holds any thread at all, whatever was typed.
  const everyCachedEmail = quickAccess.useList({
    buckets: ['email'],
    enabled: () => usesQuickAccess() && listEnabled(),
  });
  const usesRecentThreads = () =>
    usesQuickAccess() &&
    !everyCachedEmail.items().some((item) => !item.data.isDraft);
  // Like the search below, asks again whenever it is shown.
  const recentThreadsQuery = useSoupItemsQuery(
    () => RECENT_EMAIL_THREADS_ARGS,
    () => ({
      enabled: usesRecentThreads() && listEnabled(),
      staleTime: 0,
    })
  );
  const recentThreads = createLazyMemo((): EntityItem[] => {
    if (!recentThreadsQuery.isSuccess) return [];
    return recentThreadsQuery.data
      .filter(
        (entity): entity is EmailEntity =>
          entity.type === 'email' && !entity.isDraft
      )
      .map(emailEntityItem);
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
      .map(emailEntityItem);
  });

  const emailSearch = createFreshSearch<EntityItem>({
    config: { timeWeight: 0, brevityWeight: 0.3 },
    getName: (item) => item.searchText,
    getTimestamp: (item) => item.timestamps,
  });

  const emails = createLazyMemo((): EntityItem[] => {
    const term = searchTerm();
    if (usesRecentThreads()) {
      const recent = recentThreads();
      if (!term) return recent;
      return emailSearch(recent, term).map(({ item }) => item);
    }
    if (usesQuickAccess()) return cachedThreads();

    const remoteEmails = remoteEmailList();
    if (!term) return remoteEmails;
    return emailSearch(remoteEmails, term).map(({ item }) => item);
  });

  return {
    emails,
    totalCount: () =>
      usesQuickAccess() && !usesRecentThreads()
        ? cachedEmails.totalCount() -
          (cachedEmails.items().length - emails().length)
        : emails().length,
    // The REST list is one page of the newest threads.
    hasMore: () => {
      if (usesRecentThreads()) return false;
      return usesQuickAccess()
        ? cachedEmails.hasMore()
        : Boolean(emailSearchQuery.hasNextPage);
    },
    isLoadingMore: () => {
      if (usesRecentThreads()) return recentThreadsQuery.isFetching;
      return usesQuickAccess()
        ? cachedEmails.isLoadingMore()
        : emailSearchQuery.isFetching;
    },
    loadMore: async () => {
      if (usesRecentThreads()) return;
      if (usesQuickAccess()) {
        await cachedEmails.loadMore();
      } else if (emailSearchQuery.hasNextPage) {
        await emailSearchQuery.fetchNextPage();
      }
    },
  };
}
