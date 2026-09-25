import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  createSoupLoadMoreRow,
  createTagFacetContext,
  type SoupRow,
  soupSearchMatchType,
  tagFacetReady,
  testFacets,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import { arrayEquals } from '@core/util/compareUtils';
import {
  type EmailEntity,
  type EntityData,
  isEmailEntity,
  type WithNotification,
} from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { type Accessor, createMemo, indexArray } from 'solid-js';
import { match } from 'ts-pattern';
import { EMAIL_FACETS, type EmailFacetContext } from '../filters/email-facets';
import type { EmailTab, EmailViewState } from '../types';
import { buildEmailQuery, type EmailQueryContext } from './email-query';
import { groupEmailEntitiesByDate } from './email-results';
import { buildEmailSearchRequest } from './email-search';
import { emailAdmissionBatches, mergeEmailAdmission } from './read-admission';
import { useScheduledEmailSource } from './use-scheduled-email-source';

export type EmailDataSourceItem = SoupRow<WithNotification<EntityData>>;

export type EmailDataSource = ListDataSource<EmailDataSourceItem>;

export type EmailDataSourceInput = Pick<
  EmailViewState,
  'tab' | 'search' | 'inboxIds' | 'facets'
>;

export type UseEmailDataSourceOptions = {
  /**
   * Read by the caller, not here: the source runs under the split panel's
   * owner, above the view's tag-sets provider.
   */
  tagSets: Accessor<readonly TagSetResponse[]>;
  tagSetsReady: Accessor<boolean>;
};

/**
 * The server owns importance, calendar, sent and inbox scoping, so — as with
 * the legacy presets' client filters — only the shapes a cached entity can
 * contradict are re-checked here.
 */
function emailMatchesTab(
  entity: EmailEntity,
  tab: EmailTab,
  userId: string | undefined
): boolean {
  return match(tab)
    .with('drafts', () => entity.isDraft)
    .with('shared', () => userId !== undefined && entity.ownerId !== userId)
    .with(
      'important',
      'noise',
      'sent',
      'scheduled',
      'calendar',
      'all',
      () => true
    )
    .exhaustive();
}

type AdmittedEmails = {
  scope: string;
  items: EmailEntity[];
};

type RetainedEmailPublication = AdmittedEmails & {
  resolved: Map<string, EmailEntity | undefined>;
};

/** Query, service search, and row assembly owned by the Email view. */
export function useEmailDataSource(
  state: EmailDataSourceInput,
  options: UseEmailDataSourceOptions
): EmailDataSource {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();
  const scheduled = useScheduledEmailSource(state);
  const showsScheduled = () => state.tab === 'scheduled';

  const facetContext = createMemo(
    (): EmailFacetContext => createTagFacetContext(options.tagSets())
  );

  const queryContext = createMemo(
    (): EmailQueryContext => ({
      tab: state.tab,
      inboxIds: state.inboxIds === undefined ? undefined : [...state.inboxIds],
      facets: state.facets,
      facetContext: facetContext(),
    })
  );

  // Discovery must apply read status before pagination, not scan through
  // pages of read mail to find an unread thread.
  const queryArgs = createMemo(() => buildEmailQuery(queryContext()));
  // A restored tag selection waits for the tag sets rather than listing the
  // whole mailbox and then narrowing.
  const facetsReady = () => tagFacetReady(state.facets, options.tagSetsReady());
  const sourceEnabled = () => facetsReady() && state.tab !== 'scheduled';
  const query = useSoupAstItemsQuery(queryArgs, () => ({
    enabled: sourceEnabled(),
  }));
  const isListPending = () =>
    !facetsReady() || query.isLoading || query.isPlaceholderData;

  const selectEmails = (entities: EntityData[]): EmailEntity[] => {
    const context = queryContext();
    const selected: EmailEntity[] = [];
    for (const entity of entities) {
      if (!isEmailEntity(entity)) continue;
      if (!emailMatchesTab(entity, context.tab, userId())) continue;

      selected.push(entity);
    }
    return selected;
  };

  // The quick-access pool behind local search holds no email threads, so
  // every search result comes from the search service.
  const search = createSearchState({
    text: () => state.search,
    // Held back with the list query so a tag selection is not stripped from
    // the request before the sets that resolve it have loaded.
    enabled: sourceEnabled,
    disableLocalSearch: () => true,
    buildRequest: (request) => buildEmailSearchRequest(queryContext(), request),
  });

  const rawEntities = createMemo<EntityData[]>(() => {
    // Disabled searches can retain placeholder data for the previous facets.
    if (!facetsReady()) return [];

    if (!search.isSearching()) {
      // Previous-tab/inbox rows are not valid results for the new query.
      // REST placeholders need the same treatment as pending GraphQL reads.
      // Background refreshes still retain usable current-query cache results.
      if (isListPending()) return [];

      return query.data?.entities ?? [];
    }

    // Never admit the previous text/filter query's placeholder results.
    if (!search.usesServiceSearch() || search.searchQuery.isPlaceholderData)
      return [];
    return search.data();
  });

  const hasReadFilter = () => (state.facets.read?.length ?? 0) > 0;
  const scope = createMemo(() =>
    JSON.stringify([
      userId(),
      queryArgs().body,
      state.facets,
      state.search.trim(),
    ])
  );
  const matchesOtherFacets = (email: EmailEntity) =>
    testFacets(
      { ...state.facets, read: [] },
      EMAIL_FACETS,
      email,
      facetContext()
    );

  // Remember identity and position, not permanent membership. Bounded readers
  // below keep admitted rows live without weakening discovery's read filter.
  const admitted = createMemo<AdmittedEmails>(
    (previous) => {
      const currentScope = scope();
      if (!hasReadFilter()) return { scope: currentScope, items: [] };
      const previousItems =
        previous.scope === currentScope ? previous.items : [];
      const known = new Set(previousItems.map((email) => email.id));
      const current = selectEmails(rawEntities()).filter(
        (email) =>
          matchesOtherFacets(email) &&
          (known.has(email.id) ||
            testFacets(
              { read: state.facets.read ?? [] },
              EMAIL_FACETS,
              email,
              facetContext()
            ))
      );
      return {
        scope: currentScope,
        items: mergeEmailAdmission(previousItems, current),
      };
    },
    { scope: '', items: [] }
  );

  const admissionBatches = createMemo(
    () => (facetsReady() ? emailAdmissionBatches(admitted().items) : []),
    [],
    {
      equals: (left, right) =>
        left.length === right.length &&
        left.every((ids, index) => arrayEquals(ids, right[index])),
    }
  );
  const retainedQueries = indexArray(admissionBatches, (ids) => {
    const list = useSoupAstItemsQuery(
      () => buildEmailQuery(queryContext(), ids()),
      () => ({ enabled: facetsReady() && !search.isSearching() })
    );
    const searchQuery = useSearchSoupQuery(
      () =>
        buildEmailSearchRequest(
          queryContext(),
          {
            query: state.search.trim(),
            matchType: soupSearchMatchType(state.search),
          },
          ids()
        ),
      () => ({ enabled: facetsReady() && search.usesServiceSearch() })
    );
    return {
      ids,
      data: () =>
        search.isSearching()
          ? searchQuery.isSuccess && !searchQuery.isPlaceholderData
            ? searchQuery.data
            : undefined
          : !list.isLoading && !list.isPlaceholderData
            ? list.data?.entities
            : undefined,
      error: () => (search.isSearching() ? searchQuery.error : list.error),
      refresh: async () => {
        if (search.usesServiceSearch()) await searchQuery.refetch();
        else if (!search.isSearching()) await list.refresh();
      },
    };
  });

  const publication = createMemo<RetainedEmailPublication>(
    (previous) => {
      const currentScope = scope();
      if (!facetsReady() || (!search.isSearching() && isListPending())) {
        return { scope: currentScope, items: [], resolved: new Map() };
      }
      if (!hasReadFilter()) {
        return {
          scope: currentScope,
          items: selectEmails(rawEntities()).filter(matchesOtherFacets),
          resolved: new Map(),
        };
      }
      // Carry the last confirmed lookup through a new batch's pending read,
      // including explicit non-membership. Otherwise pagination can flash old
      // unread flags or resurrect an archived row from its discovery snapshot.
      const current = new Map(
        previous.scope === currentScope ? previous.resolved : []
      );
      for (const lookup of retainedQueries()) {
        const data = lookup.data();
        if (data === undefined) continue;
        const byId = new Map(
          selectEmails(data).map((email) => [email.id, email])
        );
        for (const id of lookup.ids()) current.set(id, byId.get(id));
      }
      return {
        scope: currentScope,
        resolved: current,
        items: admitted().items.flatMap((snapshot) => {
          // Snapshots bridge the first pending lookup only; subsequent pending
          // reads retain the canonical value or exclusion from that lookup.
          const email = current.has(snapshot.id)
            ? current.get(snapshot.id)
            : snapshot;
          return email && matchesOtherFacets(email) ? [email] : [];
        }),
      };
    },
    { scope: '', items: [], resolved: new Map() }
  );
  const entities = () => publication().items;

  const listEntities = createMemo((): WithNotification<EntityData>[] =>
    entities().map((email) =>
      withEntityNotifications(email, notificationSource)
    )
  );

  const usesServiceSearch = search.usesServiceSearch;

  const hasMore = () => {
    if (usesServiceSearch()) return search.hasNextPage();
    return !isListPending() && query.hasNextPage;
  };

  const isLoadingMore = () => {
    if (usesServiceSearch()) return search.isFetchingNextPage();
    return query.isFetchingNextPage;
  };

  const items = createMemo<EmailDataSourceItem[]>(() => {
    // Search results keep their relevance order, so only the list page is
    // bucketed by date.
    const result: EmailDataSourceItem[] = search.isSearching()
      ? buildFlatSoupRows(listEntities())
      : buildGroupedSoupRows(groupEmailEntitiesByDate(listEntities()));

    if (hasMore()) {
      result.push(
        createSoupLoadMoreRow({
          scopeId: `email:${state.tab}`,
          isLoading: isLoadingMore(),
        })
      );
    }

    return result;
  });

  const isLoading = () => {
    if (!facetsReady()) return true;
    if (!search.isSearching()) {
      // A query held back for the tag sets is loading, not empty.
      return isListPending();
    }
    if (entities().length > 0) return false;
    if (usesServiceSearch()) return search.isLoading();
    return query.isLoading;
  };

  return {
    items: () => (showsScheduled() ? scheduled.items() : items()),
    isLoading: () => (showsScheduled() ? scheduled.isLoading() : isLoading()),
    isFetching: () => {
      if (showsScheduled()) return scheduled.isFetching();
      if (search.isSettling()) return true;
      return usesServiceSearch() ? search.isFetching() : query.isFetching;
    },
    error: () => {
      if (showsScheduled()) return scheduled.error();
      return (
        (usesServiceSearch() ? search.error() : query.error) ??
        retainedQueries()
          .map((lookup) => lookup.error())
          .find((error) => error instanceof Error) ??
        undefined
      );
    },
    hasMore: () => !showsScheduled() && hasMore(),
    isLoadingMore: () => !showsScheduled() && isLoadingMore(),
    loadMore: async () => {
      if (showsScheduled()) return;
      if (usesServiceSearch()) {
        await search.fetchNextPage();
        return;
      }
      await query.fetchNextPage();
    },
    refresh: async () => {
      if (showsScheduled()) {
        await scheduled.refresh();
        return;
      }
      await Promise.all([
        usesServiceSearch() ? search.refetch() : query.refresh(),
        ...retainedQueries().map((lookup) => lookup.refresh()),
      ]);
    },
  } satisfies EmailDataSource;
}
