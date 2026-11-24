import type { ListDataSource } from '@app/components/list';
import { createPositionHolds } from '@app/features/next-soup/position-holds';
import type { EmailRowReminder } from '@app/features/reminders/core/email-row-reminder';
import {
  buildFlatSoupRows,
  createSearchState,
  createSoupLoadMoreRow,
  createSoupRowStore,
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
import { matchesTokenSubsequences } from '@core/util/string';
import {
  type EmailEntity,
  type EntityData,
  isEmailEntity,
  type WithNotification,
} from '@entity';
import {
  createLocalDraftSource,
  localDraftEntities,
} from '@queries/email/local-draft-source';
import { useFavoritesQuery } from '@queries/favorites/favorites';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { type Accessor, createMemo, createSignal, indexArray } from 'solid-js';
import { match } from 'ts-pattern';
import { canSearchEmailTab, isExcludedEmailFolder } from '../constants';
import { EMAIL_FACETS, type EmailFacetContext } from '../filters/email-facets';
import {
  type EmailSearchScope,
  emailSearchScopeTab,
} from '../search/email-search-scope';
import type { EmailTab, EmailViewState } from '../types';
import {
  advanceEmptyPages,
  EMPTY_PAGES_LOAD_MORE_LABEL,
} from './advance-empty-pages';
import {
  buildEmailQuery,
  type EmailQueryContext,
  type EmailSavedViewScope,
} from './email-query';
import { buildEmailDateRows } from './email-results';
import {
  buildEmailSearchRequest,
  type EmailSearchContext,
  facetsLeftToClient,
} from './email-search';
import { emailAdmissionBatches, mergeEmailAdmission } from './read-admission';
import { useEmailListRefresh } from './use-email-list-refresh';
import { useFocusEmailSource } from './use-focus-email-source';
import { useReminderEmailSource } from './use-reminder-email-source';
import { useScheduledEmailSource } from './use-scheduled-email-source';

export type EmailDataSourceItem = SoupRow<WithNotification<EntityData>>;

export type EmailDataSource = ListDataSource<EmailDataSourceItem> & {
  reminderForThread?: (threadId: string) => EmailRowReminder | undefined;
  /** Keeps rows in place while an action changes their sort. */
  positions?: { hold: (entityIds: readonly string[]) => void };
  /** The rows are the previous search's, shown while the next one loads. */
  showsPreviousRows?: Accessor<boolean>;
};

type ShownEmailRows = {
  items: EmailDataSourceItem[];
  tab: EmailViewState['tab'];
  /** The query the items were built for. */
  scope: string;
  /** The account that built the items. */
  viewer: string | undefined;
  searching: boolean;
  /** The items belong to the query before the one now loading. */
  previous: boolean;
};

export type EmailDataSourceInput = Pick<
  EmailViewState,
  'tab' | 'inboxIds' | 'facets' | 'focusSort' | 'aliasFilter'
> & {
  /** The words searched for, without the `in:` filter. */
  search: string;
  /** The mail a search reaches: all of it unless an `in:` filter names a view. */
  searchScope: EmailSearchScope;
};

export type UseEmailDataSourceOptions = {
  /**
   * Read by the caller, not here: the source runs under the split panel's
   * owner, above the view's tag-sets provider.
   */
  tagSets: Accessor<readonly TagSetResponse[]>;
  tagSetsReady: Accessor<boolean>;
  /** A saved view's tag bindings, kept even when the tag's set is unreadable. */
  tagBindings?: Accessor<ReadonlyMap<string, string> | undefined>;
  /**
   * Conditions resolved for one query: an open view's, or a tab's once its
   * filters leave what the tab itself selects. Either lists mail as a view.
   */
  savedView?: Accessor<EmailSavedViewScope | undefined>;
  /** False while the list must not query, such as a loading saved view. */
  enabled?: Accessor<boolean>;
  /** Keep the rows on screen, marked as previous, while a search loads. */
  keepRowsWhileSearching?: Accessor<boolean>;
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
  return (
    match(tab)
      .with('drafts', () => entity.isDraft)
      .with('archived', () => entity.done === true)
      .with('shared', () => userId !== undefined && entity.ownerId !== userId)
      // The inbox views list only threads still in the inbox; a cached page can
      // carry a row whose record was archived after the page was fetched.
      .with('important', 'noise', () => entity.done !== true)
      .with(
        'favorites',
        'sent',
        'scheduled',
        'reminders',
        'calendar',
        'all',
        'focus',
        'spam',
        'trash',
        () => true
      )
      .exhaustive(() => true)
  );
}

/**
 * The same re-check for a search hit, by the view the search names. A hit's
 * draft flag describes the thread's latest message, not whether it holds a
 * draft, so Drafts trusts the service's Drafts scoping.
 */
function emailMatchesSearchScope(
  entity: EmailEntity,
  scope: EmailSearchScope,
  userId: string | undefined
): boolean {
  return match(scope)
    .with('archived', () => entity.done === true)
    .with('shared', () => userId !== undefined && entity.ownerId !== userId)
    .with('inbox', 'focus', 'signal', 'noise', () => entity.done !== true)
    .with('favorites', 'sent', 'drafts', 'calendar', 'all', () => true)
    .exhaustive(() => true);
}

// Provider-neutral folder membership needs a server lookup; arbitrary realtime
// entities cannot establish it from labels (Outlook has no Gmail system labels).
const rejectFolderInsert = () => false;
const folderQueryOptions = (tab: EmailTab) =>
  isExcludedEmailFolder(tab)
    ? {
        keepPreviousData: false,
        meta: { normalize: false, insertFilter: rejectFolderInsert },
      }
    : {};

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
  const reminders = useReminderEmailSource(state, options);
  const focus = useFocusEmailSource(state, options);
  // A search lists the mail it reaches, whichever tab it starts from.
  const showsReminders = () =>
    state.tab === 'reminders' && !search.isSearching();
  const showsFocus = () => state.tab === 'focus' && !search.isSearching();
  const showsScheduled = () =>
    state.tab === 'scheduled' && !search.isSearching();
  const showsFavorites = () => state.tab === 'favorites';
  const searchesFavorites = () => state.searchScope === 'favorites';
  const searchesFocus = () => state.searchScope === 'focus';
  // Guard the data read so a pending favorites request cannot suspend the view.
  const favorites = useFavoritesQuery({ entityType: ['email_thread'] });
  const favoriteThreadIds = createMemo(() =>
    favorites.isSuccess
      ? [
          ...new Set(
            favorites.data?.favorites.map((favorite) => favorite.entityId) ?? []
          ),
        ].sort()
      : undefined
  );
  const favoriteIds = createMemo(() => new Set(favoriteThreadIds()));
  const focusIds = createMemo(
    () => new Set(searchesFocus() ? focus.threadIds() : [])
  );

  const facetContext = createMemo((): EmailFacetContext => {
    const context = createTagFacetContext(options.tagSets());
    const bindings = options.tagBindings?.();
    if (!bindings?.size) return context;
    return {
      tagPropertyDefinitionByOptionId: new Map([
        ...context.tagPropertyDefinitionByOptionId,
        ...bindings,
      ]),
    };
  });
  // Search can't apply an alias or a saved view's conditions itself, so its
  // hits are kept only when the list's own predicate also admits them.
  const searchNeedsMembership = () =>
    !!state.aliasFilter || !!options.savedView?.();

  const queryContext = createMemo(
    (): EmailQueryContext => ({
      tab: state.tab,
      inboxIds: state.inboxIds === undefined ? undefined : [...state.inboxIds],
      aliasFilter: state.aliasFilter,
      facets: state.facets,
      facetContext: facetContext(),
      savedView: options.savedView?.(),
    })
  );

  // Discovery must apply read status before pagination, not scan through
  // pages of read mail to find an unread thread.
  const queryArgs = createMemo(() => buildEmailQuery(queryContext()));
  const tagsReady = () => tagFacetReady(state.facets, options.tagSetsReady());
  // Soup owns favorite filtering; only the separate search service needs the
  // IDs a Favorites or Focus search is held to.
  const scopeThreadIds = () => {
    if (searchesFavorites()) return favoriteThreadIds();
    if (searchesFocus()) return focus.threadIds();
    return [];
  };
  const searchScopeReady = () => scopeThreadIds() !== undefined;
  const filtersReady = () =>
    tagsReady() && (!state.search.trim() || searchScopeReady());
  const enabled = () => (options.enabled?.() ?? true) && tagsReady();
  const listEnabled = () =>
    enabled() &&
    state.tab !== 'scheduled' &&
    state.tab !== 'reminders' &&
    state.tab !== 'focus';
  const sourceEnabled = () =>
    search.isSearching() ? enabled() : listEnabled();
  // A search keeps the list's filters but reaches the mail its scope names,
  // not the tab's own slice of it. An alias or saved view checks its hits
  // against the list of the view the search names (Inbox's against All).
  const searchQueryContext = (): EmailQueryContext => ({
    ...queryContext(),
    tab:
      state.searchScope === 'all'
        ? 'all'
        : (emailSearchScopeTab(state.searchScope) ?? 'all'),
  });
  const searchContext = (): EmailSearchContext => ({
    ...searchQueryContext(),
    scope: state.searchScope,
    scopeThreadIds: scopeThreadIds(),
  });
  const query = useSoupAstItemsQuery(queryArgs, () => ({
    enabled: listEnabled(),
    // Folder previews must not overwrite the same thread's All Mail preview.
    ...folderQueryOptions(state.tab),
  }));
  const localDrafts = createLocalDraftSource(
    () => query.transport === 'graphql'
  );
  const isListPending = () =>
    !filtersReady() || query.isPending || query.isPlaceholderData;

  const selectEmails = (entities: EntityData[]): EmailEntity[] => {
    // Rows and their lookups come from search hits while searching.
    const searching = search.isSearching();
    const tab = queryContext().tab;
    const selected: EmailEntity[] = [];
    for (const entity of entities) {
      if (!isEmailEntity(entity)) continue;
      if (searching) {
        if (!emailMatchesSearchScope(entity, state.searchScope, userId()))
          continue;
        // Search results have no Soup favorite field and use search's ID scope.
        if (searchesFavorites() && !favoriteIds().has(entity.id)) continue;
        // A thread that has left Focus since the search ran leaves its results.
        if (searchesFocus() && !focusIds().has(entity.id)) continue;
      } else {
        if (!emailMatchesTab(entity, tab, userId())) continue;
        if (showsFavorites() && entity.isFavorited === false) continue;
      }

      selected.push(entity);
    }
    return selected;
  };

  // Mail search retains server relevance; recoverable local drafts are merged below.
  const search = createSearchState({
    surface: () => 'email',
    text: () => (canSearchEmailTab(state.tab) ? state.search : ''),
    enabled: () => enabled() && searchScopeReady(),
    disableLocalSearch: () => true,
    buildRequest: (request) =>
      buildEmailSearchRequest(searchContext(), request),
  });

  // Search retains its existing relevance service. Intersect its candidate
  // IDs with the same GraphQL alias predicate used by normal mail discovery;
  // never broaden an alias selection or depend on incomplete search previews.
  const aliasSearchBatches = createMemo(() =>
    searchNeedsMembership() &&
    search.usesServiceSearch() &&
    search.searchQuery.isSuccess &&
    !search.searchQuery.isPlaceholderData
      ? emailAdmissionBatches(selectEmails(search.data()))
      : []
  );
  const aliasSearchQueries = indexArray(aliasSearchBatches, (ids) =>
    useSoupAstItemsQuery(
      () => buildEmailQuery(searchQueryContext(), ids()),
      () => ({
        enabled: searchNeedsMembership() && search.usesServiceSearch(),
        keepPreviousData: false,
        ...folderQueryOptions(state.tab),
      })
    )
  );
  const aliasSearchPending = () =>
    aliasSearchQueries().some(
      (query) => query.isPending || query.isPlaceholderData || query.isFetching
    );
  const aliasSearchError = () =>
    aliasSearchQueries().find((query) => query.error)?.error;
  const aliasSearchIds = createMemo(
    () =>
      new Set(
        aliasSearchQueries().flatMap((query) =>
          !query.isPending && !query.isPlaceholderData
            ? (query.data?.entities.map((entity) => entity.id) ?? [])
            : []
        )
      )
  );

  const rawEntities = createMemo<EntityData[]>(() => {
    // Scheduled/Reminders/Focus disable native discovery. Reading its pending data
    // would suspend the whole split even though that query is not fetching.
    // Disabled searches can also retain previous-facet placeholder data.
    if (!sourceEnabled() || !filtersReady()) return [];

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
    return searchNeedsMembership()
      ? search.data().filter((entity) => aliasSearchIds().has(entity.id))
      : search.data();
  });

  const hasReadFilter = () => (state.facets.read?.length ?? 0) > 0;
  const scope = createMemo(() =>
    JSON.stringify([
      userId(),
      queryArgs().body,
      state.facets,
      state.search.trim(),
      state.searchScope,
    ])
  );
  const matchesOtherFacets = (email: EmailEntity) =>
    testFacets(
      search.isSearching() && search.usesServiceSearch()
        ? facetsLeftToClient(state.facets)
        : { ...state.facets, read: [] },
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
    () => (filtersReady() ? emailAdmissionBatches(admitted().items) : []),
    [],
    {
      equals: (left, right) =>
        left.length === right.length &&
        left.every((ids, index) => arrayEquals(ids, right[index])),
    }
  );
  const retainedQueries = indexArray(admissionBatches, (ids) => {
    const list = useSoupAstItemsQuery(
      () =>
        buildEmailQuery(
          search.isSearching() ? searchQueryContext() : queryContext(),
          ids()
        ),
      () => ({
        enabled:
          filtersReady() && (!search.isSearching() || searchNeedsMembership()),
        ...folderQueryOptions(state.tab),
      })
    );
    const searchQuery = useSearchSoupQuery(
      () =>
        buildEmailSearchRequest(
          searchContext(),
          {
            query: state.search.trim(),
            matchType: soupSearchMatchType(state.search),
          },
          ids()
        ),
      () => ({ enabled: filtersReady() && search.usesServiceSearch() })
    );
    return {
      ids,
      data: () => {
        if (!search.isSearching())
          return !list.isPending && !list.isPlaceholderData
            ? list.data?.entities
            : undefined;
        if (!searchQuery.isSuccess || searchQuery.isPlaceholderData)
          return undefined;
        if (!searchNeedsMembership()) return searchQuery.data;
        if (list.isPending || list.isPlaceholderData) return undefined;
        const members = list.data?.entities;
        // A failed membership read is unknown, not proof every row disappeared.
        if (!members) return undefined;
        const memberIds = new Set(members.map((entity) => entity.id));
        return searchQuery.data.filter((entity) => memberIds.has(entity.id));
      },
      error: () =>
        search.isSearching()
          ? (searchQuery.error ??
            (searchNeedsMembership() ? list.error : undefined))
          : list.error,
      refresh: async () => {
        if (search.usesServiceSearch()) {
          await Promise.all([
            searchQuery.refetch(),
            ...(searchNeedsMembership() ? [list.refresh()] : []),
          ]);
        } else if (!search.isSearching()) await list.refresh();
      },
    };
  });

  const publication = createMemo<RetainedEmailPublication>(
    (previous) => {
      const currentScope = scope();
      if (!filtersReady() || (!search.isSearching() && isListPending())) {
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
          return email &&
            selectEmails([email]).length > 0 &&
            matchesOtherFacets(email)
            ? [email]
            : [];
        }),
      };
    },
    { scope: '', items: [], resolved: new Map() }
  );
  // Working copies can exist before sender metadata allows a GraphQL save.
  // Keep them discoverable without waiting for the remote list/search.
  // A saved view's conditions can't be checked against a local working copy.
  const listsLocalDrafts = () => {
    if (options.savedView?.()) return false;
    if (!search.isSearching()) return state.tab === 'drafts';
    return state.searchScope === 'all' || state.searchScope === 'drafts';
  };
  const recoverable = () =>
    listsLocalDrafts()
      ? localDraftEntities(localDrafts.drafts()).filter(
          (email) => email.ownerId === userId()
        )
      : [];
  // Resolve recovery threads independently of the active filters. Otherwise an
  // excluded thread could reappear with the synthetic first-use draft flags.
  const recoveryBatches = createMemo(() =>
    emailAdmissionBatches(recoverable())
  );
  const recoveryQueries = indexArray(recoveryBatches, (ids) =>
    useSoupAstItemsQuery(
      () =>
        buildEmailQuery(
          {
            tab: 'all',
            inboxIds: undefined,
            facets: {},
            facetContext: facetContext(),
          },
          ids()
        ),
      () => ({ enabled: sourceEnabled(), keepPreviousData: false })
    )
  );
  const localRows = () => {
    if (!filtersReady()) return [];
    const remote = new Map(
      [
        ...recoveryQueries().flatMap((query) =>
          !query.isPending && !query.isPlaceholderData
            ? (query.data?.entities.filter(isEmailEntity) ?? [])
            : []
        ),
        ...rawEntities().filter(isEmailEntity),
        ...publication().items,
      ].map((email) => [email.id, email])
    );
    return recoverable()
      .map((email) => {
        const confirmed = remote.get(email.id);
        return confirmed
          ? {
              ...confirmed,
              name: email.name,
              snippet: email.snippet,
              updatedAt: email.updatedAt,
            }
          : email;
      })
      .filter(
        (email) =>
          email.ownerId === userId() &&
          (!state.inboxIds?.length ||
            (!!email.linkId && state.inboxIds.includes(email.linkId))) &&
          (!state.aliasFilter ||
            (email.linkId === state.aliasFilter.inboxId &&
              email.senderEmail?.toLowerCase() ===
                state.aliasFilter.emailAddress.toLowerCase())) &&
          testFacets(state.facets, EMAIL_FACETS, email, facetContext()) &&
          matchesTokenSubsequences(email.name, state.search.trim())
      );
  };
  const entities = () => {
    const recovered = localRows();
    const ids = new Set(recovered.map((email) => email.id));
    return [
      ...recovered,
      ...publication().items.filter((email) => !ids.has(email.id)),
    ];
  };

  // Discarding a draft moves a thread back to its last received message;
  // the row stays where it was until the list's scope changes.
  const positions = createPositionHolds({ scope });
  const listEntities = createMemo((): WithNotification<EntityData>[] => {
    const rows = entities().map((email) =>
      withEntityNotifications(email, notificationSource)
    );
    return search.isSearching() ? rows : positions.apply(rows);
  });

  const usesServiceSearch = search.usesServiceSearch;
  const [refreshing, setRefreshing] = createSignal(false);
  // A page of hits can leave no rows: membership or a client-side facet drops
  // them, or the service's state checks (Archived's done) ran out before
  // keeping one. Page on, a bounded run per load, until a row shows.
  // Favorites search sends the favorite ids, so a new set is a new search.
  const searchScope = createMemo(() =>
    searchesFavorites() || searchesFocus()
      ? JSON.stringify([scope(), scopeThreadIds()])
      : scope()
  );
  const emptyPages = advanceEmptyPages({
    scope: searchScope,
    enabled: () => sourceEnabled() && usesServiceSearch(),
    ready: () =>
      filtersReady() &&
      search.searchQuery.isSuccess &&
      !search.isFetching() &&
      !refreshing() &&
      !search.searchQuery.isPlaceholderData &&
      !aliasSearchPending() &&
      !search.error() &&
      !aliasSearchError() &&
      !retainedQueries().some((query) => query.error()),
    rows: () => entities().map((email) => email.id),
    hasNextPage: search.hasNextPage,
    loadMore: search.fetchNextPage,
  });

  const hasMore = () => {
    if (!filtersReady()) return false;
    if (usesServiceSearch()) return search.hasNextPage();
    // A search the service has not run (still debouncing) lists
    // no inbox rows, so the inbox's next page is not this list's next page.
    if (search.isSearching()) return false;
    return !isListPending() && query.hasNextPage;
  };

  const isLoadingMore = () => {
    if (usesServiceSearch())
      return (
        search.isFetchingNextPage() ||
        aliasSearchPending() ||
        emptyPages.isFetching()
      );
    return query.isFetchingNextPage;
  };

  const builtItems = createMemo<EmailDataSourceItem[]>(() => {
    // Search results keep their relevance order, so only the list page is
    // bucketed by date.
    const result: EmailDataSourceItem[] = search.isSearching()
      ? buildFlatSoupRows(listEntities())
      : buildEmailDateRows(listEntities(), new Date(), positions.sortTs);

    if (hasMore()) {
      result.push(
        createSoupLoadMoreRow({
          scopeId: `email:${state.tab}`,
          isLoading: isLoadingMore(),
          ...(emptyPages.stoppedShort()
            ? { label: EMPTY_PAGES_LOAD_MORE_LABEL }
            : {}),
        })
      );
    }

    return result;
  });
  const awaitsRows = () => {
    if (localRows().length > 0) return false;
    if (search.isSearching() && searchesFavorites() && favorites.isError)
      return false;
    if (!filtersReady()) return true;
    if (!search.isSearching()) {
      // A query held back for the tag sets is loading, not empty.
      return isListPending();
    }
    if (entities().length > 0) return false;
    if (usesServiceSearch())
      return (
        search.isLoading() || aliasSearchPending() || emptyPages.isFetching()
      );
    // Not `search.isLoading()`: it keeps the previous query's hits for a
    // moment, which would read as "no results" before the spinner.
    return search.isSearchServiceLoading();
  };

  // A search that is still loading keeps the rows it replaces on screen: a
  // blank list between two queries reads as "no results". The rows stay
  // until the new ones arrive, and never cross a tab change.
  //
  // "Still loading" asks for the search's own answer, not for a request in
  // flight: between the debounce settling and the request starting nothing
  // is fetching yet, and the list would blank for that moment.
  // `ownRows` says the rows on screen already belong to this search: its
  // later pages and their membership reads are then not a new wait.
  const searchAnswered = (ownRows: boolean) => {
    if (search.isSettling()) return false;
    if (!ownRows && aliasSearchPending()) return false;
    if (!usesServiceSearch()) return true;

    const answer = search.searchQuery;
    // An error or an offline pause is an answer too: the list's own states
    // take over instead of rows that would stay dimmed for good.
    if (answer.error || answer.fetchStatus === 'paused') return true;
    if (!answer.isSuccess || answer.isPlaceholderData) return false;
    return !answer.isFetching || answer.isFetchingNextPage;
  };
  const shownRows = createMemo<ShownEmailRows>(
    (previous) => {
      const searching = search.isSearching();
      const current = scope();
      const viewer = userId();
      const ownRows = !previous.previous && previous.scope === current;
      const waits = searching ? !searchAnswered(ownRows) : awaitsRows();
      const keepsPrevious =
        (options.keepRowsWhileSearching?.() ?? false) &&
        waits &&
        !ownRows &&
        previous.tab === state.tab &&
        // Another account's rows are never shown, even dimmed.
        previous.viewer === viewer &&
        previous.items.length > 0 &&
        (searching || previous.searching);
      if (keepsPrevious) return { ...previous, searching, previous: true };

      return {
        items: builtItems(),
        tab: state.tab,
        scope: current,
        viewer,
        searching,
        previous: false,
      };
    },
    {
      items: [],
      tab: state.tab,
      scope: '',
      viewer: undefined,
      searching: false,
      previous: false,
    }
  );
  const items = createSoupRowStore(() => shownRows().items);
  const isLoading = () => awaitsRows() && !shownRows().previous;

  const dataSource = {
    positions: {
      hold: (entityIds) => positions.hold(listEntities(), entityIds),
    },
    reminderForThread: (threadId) =>
      showsReminders() ? reminders.reminderForThread?.(threadId) : undefined,
    showsPreviousRows: () =>
      !showsReminders() &&
      !showsScheduled() &&
      !showsFocus() &&
      shownRows().previous,
    items: () =>
      showsReminders()
        ? reminders.items()
        : showsScheduled()
          ? scheduled.items()
          : showsFocus()
            ? focus.items()
            : items(),
    isLoading: () =>
      showsReminders()
        ? reminders.isLoading()
        : showsScheduled()
          ? scheduled.isLoading()
          : showsFocus()
            ? focus.isLoading()
            : isLoading(),
    isFetching: () => {
      if (showsReminders()) return reminders.isFetching();
      if (showsScheduled()) return scheduled.isFetching();
      if (showsFocus()) return focus.isFetching();
      if (search.isSettling()) return true;
      return (
        refreshing() ||
        emptyPages.isFetching() ||
        (usesServiceSearch() ? search.isFetching() : query.isFetching)
      );
    },
    error: () => {
      if (showsReminders()) return reminders.error();
      if (showsScheduled()) return scheduled.error();
      if (showsFocus()) return focus.error();
      return (
        (search.isSearching() && searchesFavorites()
          ? favorites.error
          : undefined) ??
        (search.isSearching() && searchesFocus() ? focus.error() : undefined) ??
        (usesServiceSearch() ? search.error() : query.error) ??
        aliasSearchError() ??
        emptyPages.error() ??
        retainedQueries()
          .map((lookup) => lookup.error())
          .find((error) => error instanceof Error) ??
        undefined
      );
    },
    hasMore: () =>
      showsReminders()
        ? reminders.hasMore()
        : !showsScheduled() && !showsFocus() && hasMore(),
    isLoadingMore: () =>
      showsReminders()
        ? reminders.isLoadingMore()
        : !showsScheduled() && !showsFocus() && isLoadingMore(),
    loadMore: async () => {
      if (showsReminders()) {
        await reminders.loadMore();
        return;
      }
      if (showsScheduled() || showsFocus()) return;
      if (usesServiceSearch()) {
        await emptyPages.loadMore();
        return;
      }
      if (search.isSearching()) return;
      await query.fetchNextPage();
    },
    refresh: async () => {
      if (showsReminders()) {
        await reminders.refresh();
        return;
      }
      if (showsScheduled()) {
        await scheduled.refresh();
        return;
      }
      if (showsFocus()) {
        await focus.refresh();
        return;
      }
      const requestScope = scope();
      setRefreshing(true);
      emptyPages.resetError();
      try {
        if (search.isSearching() && searchesFavorites())
          await favorites.refetch();
        if (search.isSearching() && searchesFocus()) await focus.refresh();
        await (usesServiceSearch() ? search.refetch() : query.refresh());
        if (scope() !== requestScope) return;
        // Refresh admission after search publishes its candidates: a refetch
        // can detach/recreate these readers even when their IDs stay the same.
        await Promise.all([
          ...(usesServiceSearch() && searchNeedsMembership()
            ? aliasSearchQueries().map((lookup) => lookup.refresh())
            : []),
          ...retainedQueries().map((lookup) => lookup.refresh()),
        ]);
      } finally {
        setRefreshing(false);
      }
    },
  } satisfies EmailDataSource;
  useEmailListRefresh({
    enabled: () => sourceEnabled() && state.inboxIds?.length !== 0,
    scope,
    matchesLink: (linkId) =>
      (state.inboxIds === undefined || state.inboxIds.includes(linkId)) &&
      (!state.aliasFilter || state.aliasFilter.inboxId === linkId),
    isFetching: () => dataSource.isFetching() || dataSource.isLoadingMore(),
    refresh: async (catchUp) => {
      // These sources own their own invalidation, and service search is a
      // submitted snapshot. Generic mailbox hints extend ordinary lists only.
      if (
        showsReminders() ||
        showsScheduled() ||
        showsFocus() ||
        usesServiceSearch()
      )
        return;
      // Isolated folder previews bypass both shared caches. Their known rows
      // require a full read, still coalesced behind the same paging gate.
      if (catchUp || isExcludedEmailFolder(state.tab)) await query.refresh();
      else await query.refreshHead();
    },
  });
  return dataSource;
}
