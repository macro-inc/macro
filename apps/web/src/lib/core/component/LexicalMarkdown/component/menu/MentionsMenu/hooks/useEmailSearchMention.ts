import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { type EntityItem, useQuickAccess } from '@core/context/quickAccess';
import { createFreshSearch } from '@core/util/freshSort';
import type { EmailEntity, WithSearch } from '@entity';
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
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';

const USE_QUICK_ACCESS_FOR_EMAIL_MENTIONS: boolean = false;

/** The viewer's newest threads, for when the GraphQL cache is off. */
function recentEmailThreadsArgs(): SoupItemsQueryArgs {
  return {
    params: { limit: 20, sort_method: 'updated_at' },
    body: { ...QUERY_FILTERS_BASE, email_filters: {} },
  };
}

function emailEntityItem(email: EmailEntity): EntityItem {
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
    data: email,
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

/** Where the listed emails come from. */
type EmailMentionSource = 'search' | 'quickAccess' | 'recentThreads';

/**
 * Provides email mentions through unified search by default. Quick Access
 * supplies them behind USE_QUICK_ACCESS_FOR_EMAIL_MENTIONS, and for
 * `recentWhenShort` menus while the term is too short to search. Its email
 * bucket needs the GraphQL cache, so without the cache those menus list the
 * newest threads from the REST Soup list instead.
 */
export function useEmailSearchMention(
  options: UseEmailSearchMentionOptions
): UseEmailSearchMentionResult {
  const { searchTerm, enabled } = options;
  const listEnabled = () => enabled?.() !== false;
  const quickAccess = useQuickAccess();
  const source = createMemo((): EmailMentionSource => {
    const cacheServesEmails = quickAccess.usesRecordSelection();
    if (USE_QUICK_ACCESS_FOR_EMAIL_MENTIONS && cacheServesEmails)
      return 'quickAccess';
    const listsRecent =
      options.recentWhenShort?.() === true &&
      !validateSearchServiceText(searchTerm().trim());
    if (!listsRecent) return 'search';
    return cacheServesEmails ? 'quickAccess' : 'recentThreads';
  });

  const cachedEmails = quickAccess.useList({
    buckets: ['email'],
    searchTerm,
    enabled: () => source() === 'quickAccess' && listEnabled(),
  });
  // Drafts, local ones included, are not threads a mention can point to.
  const cachedThreads = createLazyMemo(() =>
    cachedEmails.items().filter((item) => !item.data.isDraft)
  );

  // Like the search below, asks again whenever it is shown.
  const recentThreadsQuery = useSoupItemsQuery(recentEmailThreadsArgs, () => ({
    enabled: source() === 'recentThreads' && listEnabled(),
    staleTime: 0,
  }));
  const recentThreads = createLazyMemo((): EntityItem[] => {
    if (recentThreadsQuery.isPending) return [];
    return (recentThreadsQuery.data ?? [])
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
    enabled: source() === 'search' && listEnabled(),
    staleTime: 0,
  }));

  const remoteEmailList = createLazyMemo((): EntityItem[] => {
    if (emailSearchQuery.status !== 'success') return [];
    return emailSearchQuery.data
      .filter((e): e is WithSearch<EmailEntity> => e.type === 'email')
      .map(emailEntityItem);
  });

  const emailSearch = createFreshSearch<EntityItem>({
    config: { timeWeight: 0, brevityWeight: 0.3 },
    getName: (item) => item.searchText,
    getTimestamp: (item) => item.timestamps,
  });
  const matchingTerm = (items: EntityItem[]): EntityItem[] => {
    const term = searchTerm();
    if (!term) return items;
    return emailSearch(items, term).map(({ item }) => item);
  };

  const emails = createLazyMemo((): EntityItem[] =>
    match(source())
      .with('quickAccess', () => cachedThreads())
      .with('recentThreads', () => matchingTerm(recentThreads()))
      .with('search', () => matchingTerm(remoteEmailList()))
      .exhaustive()
  );

  return {
    emails,
    totalCount: () =>
      match(source())
        // Drafts on pages not loaded yet are still counted; the bucket lists
        // local drafts first, so that is rare.
        .with(
          'quickAccess',
          () =>
            cachedEmails.totalCount() -
            (cachedEmails.items().length - cachedThreads().length)
        )
        .with('recentThreads', 'search', () => emails().length)
        .exhaustive(),
    hasMore: () =>
      match(source())
        .with('quickAccess', () => cachedEmails.hasMore())
        // The REST list is one page of the newest threads.
        .with('recentThreads', () => false)
        .with('search', () => Boolean(emailSearchQuery.hasNextPage))
        .exhaustive(),
    isLoadingMore: () =>
      match(source())
        .with('quickAccess', () => cachedEmails.isLoadingMore())
        .with('recentThreads', () => recentThreadsQuery.isPending)
        .with('search', () => emailSearchQuery.isFetching)
        .exhaustive(),
    loadMore: async () => {
      await match(source())
        .with('quickAccess', () => cachedEmails.loadMore())
        .with('recentThreads', async () => {})
        .with('search', async () => {
          if (emailSearchQuery.hasNextPage)
            await emailSearchQuery.fetchNextPage();
        })
        .exhaustive();
    },
  };
}
