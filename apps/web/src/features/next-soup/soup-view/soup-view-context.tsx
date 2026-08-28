import {
  entityMatchesTagFilter,
  isListViewID,
  type ListView,
  soupItemMatchesListView,
  soupItemMatchesTagFilter,
} from '@app/constants/list-views';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import {
  createSoupState,
  type GroupMeta,
  type SoupEntity,
  type SoupRow,
  type SoupState,
} from '@app/features/next-soup/create-soup-state';
import type { FilterContext } from '@app/features/next-soup/filters/configs/';
import {
  compileToAst,
  NIL_UUID,
  type QueryState,
} from '@app/features/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/features/next-soup/filters/filter-store/predicates-store';
import {
  createQueryStore,
  type Query,
  type QueryStore,
} from '@app/features/next-soup/filters/filter-store/query-store';
import {
  getViewPreset,
  VIEW_TAB_PRESETS,
} from '@app/features/next-soup/sidebar/soup-filter-presets';
import { createSearchState } from '@app/features/next-soup/soup-view/create-search-state';
import {
  createTagFilter,
  type TagFilter,
} from '@app/features/next-soup/soup-view/filters-bar/tag-filter-state';
import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import {
  INBOX_FILTER_ENTRY_KEY,
  registerInboxFilterSplit,
} from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import { useSoupFilterPersistence } from '@app/features/next-soup/use-soup-filter-persistence';
import { deduplicateEntities } from '@app/features/next-soup/utils';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { makeFlaggedPersisted } from '@app/preferences/make-flagged-persisted';
import { useDealStages } from '@companies/crm/deal-stages';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useEntryState } from '@components/app/split-layout/entry-state';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  ENABLE_FEATURED_SEARCH_RESULTS,
  ENABLE_REMINDERS,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_FLAG,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  NATIVE_OFFLINE_ERROR_MESSAGE,
  nativeNetworkStatus,
} from '@core/mobile/native-network-status';
import { idToDisplayName } from '@core/user/util';
import {
  COMPANY_STAGE_OPTIONS,
  type EntityData,
  getPropertyOptionLabel,
  isWithNotification,
  unreadFilterFn,
} from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useQueryClient } from '@queries/client';
import { invalidateUserNotifications } from '@queries/notification/user-notifications';
import { createGroupedSoupQueries } from '@queries/soup/grouped/create-grouped-soup-queries';
import type {
  GroupMeta as ApiGroupMeta,
  GroupByField,
} from '@queries/soup/grouped/types';
import type { SoupParams } from '@queries/soup/items';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { soupKeys } from '@queries/soup/keys';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import { useIsTeamAdmin } from '@queries/team/teams';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { makePersisted } from '@solid-primitives/storage';
import {
  type Accessor,
  batch,
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  type FlowComponent,
  on,
  onCleanup,
  type Setter,
  Suspense,
  useContext,
} from 'solid-js';
import { unwrap } from 'solid-js/store';

type DataSource<T> = {
  data: Accessor<T[]>;
  error: Accessor<Error | null>;
  /** True when the active request has local or network data, including an
   * intentionally empty result. */
  hasData: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  /**
   * True while the query is showing placeholder data from a previous query
   * key (e.g. the prior tab's rows) and fetching the real results. Used to
   * surface a loading indicator when switching between soup tabs.
   */
  isPlaceholderData: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  hasNextPage: Accessor<boolean>;
  fetchNextPage: VoidFunction;
  /**
   * Full refresh (e.g. mobile pull-to-refresh): invalidate every soup query
   * plus notification state. Resolves once the active refetches settle.
   */
  refresh: () => Promise<void>;
};

type SoupViewInitializeOptions = {
  initialQuery?: Query;
  initialClientFilters?: SetPredicatesInput<string>;
  initialSearchText?: string;
  /** Explicit navigation state (for example a shared view) wins over storage. */
  preferInitialFilters?: boolean;
  disableLocalSearch?: boolean;
  additionalEntities?: Accessor<EntityData[]>;
  /**
   * Extra gate applied to optimistic/websocket cache inserts on top of the
   * active filters. The soup view's `itemFilter` reflects the active filters
   * (tab/search/tag), not the base query's scope, so a scoped view (e.g. a
   * folder's contents) passes this to reject inserts that fall outside its
   * scope — otherwise an entity created or opened elsewhere flashes into the
   * list until the server refetch corrects it.
   */
  itemMembershipFilter?: (item: SoupApiItem) => boolean;
};

export type ReadFilter = 'all' | 'unread' | 'read';

/** List/board display mode — currently only the Customers view offers a board. */
export type SoupViewMode = 'list' | 'board';

interface SoupViewContextValues {
  soup: SoupState;
  initialize: (options?: SoupViewInitializeOptions) => void;
  source: DataSource<EntityData>;
  searchText: Accessor<string>;
  setSearchText: (value: string) => void;
  searchPaused: Accessor<boolean>;
  setSearchPaused: Setter<boolean>;
  featuredIds: Accessor<string[]>;
  items: Accessor<SoupEntity[]>;
  rows: Accessor<SoupRow[]>;
  isSearchServiceLoading: Accessor<boolean>;
  isLocalSearchSettling: Accessor<boolean>;
  queryFilters: QueryStore;
  restorePersistedQueryFilters: (tabId: string) => boolean;
  restorePersistedPredicates: (tabId: string) => boolean;
  tagFilter: TagFilter;
  filterByTag: (optionId: string) => void;
  assigneeFilter: Accessor<string[]>;
  setAssigneeFilter: Setter<string[]>;
  ownerFilter: Accessor<string[]>;
  setOwnerFilter: Setter<string[]>;
  stageFilter: Accessor<string[]>;
  setStageFilter: Setter<string[]>;
  inboxFilter: Accessor<string[] | undefined>;
  setInboxFilter: Setter<string[] | undefined>;
  activeTab: Accessor<string | undefined>;
  setActiveTab: Setter<string | undefined>;
  getPersistedActiveTab: (view: ListView) => string | undefined;
  viewMode: Accessor<SoupViewMode>;
  setViewMode: Setter<SoupViewMode>;
  readFilter: Accessor<ReadFilter>;
  setReadFilter: Setter<ReadFilter>;
  groupByField: Accessor<GroupByField | undefined>;
  fetchNextGroupPage: (groupKey: string) => Promise<void>;
  isFetchingGroupPage: (groupKey: string) => boolean;
  hasNextGroupPage: (groupKey: string) => boolean;
}

const SoupViewContext = createContext<SoupViewContextValues>();

export const useSoupView = () => {
  const context = useContext(SoupViewContext);

  if (!context) {
    throw new Error(
      'useSoupView can only be used under a SoupViewContext.Provider'
    );
  }

  return context;
};

export const useMaybeSoupView = () => useContext(SoupViewContext);

interface SoupViewContextProviderProps extends SoupViewInitializeOptions {
  soup?: SoupState;
  initialEnabled?: boolean;
}

type PersistedQueryFilters = Partial<
  Record<ListView, Partial<Record<string, QueryState>>>
>;

const SOUP_VIEW_PERSISTENCE_VERSION = 2;
const soupViewPersistenceKey = (name: string) =>
  `${name}-v${SOUP_VIEW_PERSISTENCE_VERSION}`;

// Shared by every split so one provider cannot overwrite another provider's
// saved views with a stale local copy of the persisted map.
const [persistedQueryFilters, setPersistedQueryFilters] = makePersisted(
  createSignal<PersistedQueryFilters>({}),
  { name: soupViewPersistenceKey('soup-view-query-filters') }
);

const [persistedPredicates, setPersistedPredicates] = makePersisted(
  createSignal<
    Partial<
      Record<ListView, Partial<Record<string, SetPredicatesInput<string>>>>
    >
  >({}),
  { name: soupViewPersistenceKey('soup-view-predicates') }
);

const [persistedActiveTabs, setPersistedActiveTabs] = makePersisted(
  createSignal<Partial<Record<ListView, string>>>({}),
  { name: soupViewPersistenceKey('soup-view-active-tabs') }
);

const persistedQueryFor = (
  view: ListView,
  tabId: string
): QueryState | undefined => persistedQueryFilters()[view]?.[tabId];

/** Resolve a remembered tab id against the view's current tabs.
 *
 * Persisted ids outlive the tabs themselves: renaming a tab would otherwise
 * restore the view onto an id no preset resolves, leaving it on a tab that no
 * longer exists with no filters applied. Anything unrecognised falls back to
 * the view's default.
 */
const resolveTabId = (
  view: ListView,
  remembered: string | undefined
): string => {
  const config = VIEW_TAB_PRESETS[view];
  if (!remembered || !(remembered in config.tabs)) return config.default;
  // A remembered tab can also be flag-gated out of the tab bar (see
  // `useVisibleViewTabs`): restoring the inbox onto Reminders with the flag
  // off would leave a hidden tab active, still querying reminders.
  if (view === 'inbox' && remembered === 'reminders' && !ENABLE_REMINDERS()) {
    return config.default;
  }
  return remembered;
};

const persistedPredicatesFor = (
  view: ListView,
  tabId: string
): SetPredicatesInput<string> | undefined =>
  persistedPredicates()[view]?.[tabId];

type ApiSortMethod = Exclude<
  NonNullable<SoupParams['sort_method']>,
  'frecency' | 'touched_by_me'
>;
const VALID_API_SORT_METHODS: ApiSortMethod[] = [
  'viewed_at',
  'created_at',
  'updated_at',
  'viewed_updated',
];

const NATIVE_OFFLINE_LOAD_ERROR = new Error(NATIVE_OFFLINE_ERROR_MESSAGE);

/** Retryable load error for a data-less view once iOS reports no network path. */
function nativeOfflineLoadError(hasData: () => boolean): Error | null {
  return nativeNetworkStatus() === 'offline' && !hasData()
    ? NATIVE_OFFLINE_LOAD_ERROR
    : null;
}

export const SoupViewContextProvider: FlowComponent<
  SoupViewContextProviderProps
> = (props) => {
  const soup = props.soup ?? createSoupState();
  const [enabled, setEnabled] = createSignal(props.initialEnabled ?? false);
  const [config, setConfig] = createSignal<SoupViewInitializeOptions>({
    initialQuery: props.initialQuery,
    initialClientFilters: props.initialClientFilters,
    initialSearchText: props.initialSearchText,
    preferInitialFilters: props.preferInitialFilters,
    disableLocalSearch: props.disableLocalSearch,
    additionalEntities: props.additionalEntities,
    itemMembershipFilter: props.itemMembershipFilter,
  });

  const queryClient = useQueryClient();
  const [filterPersistenceEnabled] = useSoupFilterPersistence();

  const panel = useSplitPanelOrThrow();

  const activeListView = createMemo<ListView | undefined>(() => {
    const content = panel.handle.content();
    if (content.type !== 'component') return;
    return isListViewID(content.id) ? content.id : undefined;
  });

  const initialEntryState = panel.handle.currentEntryState();
  const initialEntryQuery = initialEntryState?.['search.filters'] as
    | Query
    | undefined;
  const initialEntryPredicates = initialEntryState?.['search.predicates'] as
    | SetPredicatesInput<string>
    | undefined;
  const initialView = activeListView();
  const initialTab = initialView
    ? resolveTabId(
        initialView,
        (initialEntryState?.['soup.tab'] as string | undefined) ??
          (filterPersistenceEnabled()
            ? persistedActiveTabs()[initialView]
            : undefined)
      )
    : undefined;
  const initialPersistedQuery =
    filterPersistenceEnabled() && initialView && initialTab
      ? persistedQueryFor(initialView, initialTab)
      : undefined;
  const initialPersistedPredicates =
    filterPersistenceEnabled() && initialView && initialTab
      ? persistedPredicatesFor(initialView, initialTab)
      : undefined;

  const store = createQueryStore({
    initial:
      initialEntryQuery ??
      (props.preferInitialFilters ? props.initialQuery : undefined) ??
      initialPersistedQuery ??
      props.initialQuery,
  });

  const initialPredicates =
    initialEntryPredicates ??
    (props.preferInitialFilters ? props.initialClientFilters : undefined) ??
    initialPersistedPredicates ??
    props.initialClientFilters;
  if (initialPredicates) soup.predicates.set(initialPredicates);

  const filterCaptorTeardown = panel.handle.registerEntryStateCaptor(
    'search.filters',
    () => structuredClone(unwrap(store.state)) as Query
  );
  onCleanup(filterCaptorTeardown);

  // Client-side predicate state (drives the "Type: X" chips and other
  // toggleable filters) also needs to round-trip per entry, since the chip UI
  // reads predicates directly and would otherwise show empty after back-nav.
  const predicatesCaptorTeardown = panel.handle.registerEntryStateCaptor(
    'search.predicates',
    (): SetPredicatesInput<string> => ({
      and: [...soup.predicates.andIds()],
      or: [...soup.predicates.orIds()],
    })
  );
  onCleanup(predicatesCaptorTeardown);

  const resetToInitialPage = () => {
    itemsQuery.resetToInitialPage();
    groupQueries.resetToInitialPage();
  };

  // Keep filters per list view and tab so refreshing or returning to a tab
  // restores its refinements without leaking them into another view or tab.
  let initializing = false;
  let changedWhilePersistenceDisabled = false;
  const persistQueryFilters = () => {
    if (!filterPersistenceEnabled()) {
      if (enabled() && !initializing) {
        changedWhilePersistenceDisabled = true;
      }
      return;
    }

    const view = activeListView();
    if (!view) return;

    const tabId = activeTab() ?? VIEW_TAB_PRESETS[view].default;
    const snapshot = structuredClone(unwrap(store.state)) as QueryState;
    setPersistedQueryFilters((current) => ({
      ...current,
      [view]: {
        ...current[view],
        [tabId]: snapshot,
      },
    }));
  };

  const queryFilters: QueryStore = {
    ...store,
    set: (query) => {
      resetToInitialPage();
      store.set(query);
      persistQueryFilters();
    },
    replace: (query) => {
      resetToInitialPage();
      store.replace(query);
      persistQueryFilters();
    },
    add: (query) => {
      resetToInitialPage();
      store.add(query);
      persistQueryFilters();
    },
    remove: (query) => {
      resetToInitialPage();
      store.remove(query);
      persistQueryFilters();
    },
  };

  const getPersistedActiveTab = (view: ListView): string | undefined =>
    filterPersistenceEnabled() ? persistedActiveTabs()[view] : undefined;

  const restorePersistedQueryFilters = (tabId: string): boolean => {
    if (!filterPersistenceEnabled()) return false;

    const view = activeListView();
    if (!view) return false;

    const persistedQuery = persistedQueryFor(view, tabId);
    if (!persistedQuery) return false;

    queryFilters.replace(persistedQuery);
    return true;
  };

  const restorePersistedPredicates = (tabId: string): boolean => {
    if (!filterPersistenceEnabled()) return false;

    const view = activeListView();
    if (!view) return false;

    const predicates = persistedPredicatesFor(view, tabId);
    if (!predicates) return false;

    soup.predicates.set(predicates);
    return true;
  };

  const tagFilter = createTagFilter(queryFilters);
  const filterByTag = (optionId: string) => tagFilter.onChange([optionId]);

  const [searchPaused, setSearchPaused] = createSignal(false);
  const sourceSearchPaused = createMemo(() => searchPaused() || !enabled());
  const [assigneeFilter, setAssigneeFilter] = makeFlaggedPersisted(
    useEntryState<string[]>('soup.assigneeFilter', { default: [] }),
    {
      enabled: filterPersistenceEnabled,
      name: soupViewPersistenceKey('soup-view-assignee-filter'),
    }
  );
  const [ownerFilter, setOwnerFilter] = makeFlaggedPersisted(
    useEntryState<string[]>('soup.ownerFilter', { default: [] }),
    {
      enabled: filterPersistenceEnabled,
      name: soupViewPersistenceKey('soup-view-owner-filter'),
    }
  );
  const [stageFilter, setStageFilter] = makeFlaggedPersisted(
    useEntryState<string[]>('soup.stageFilter', { default: [] }),
    {
      enabled: filterPersistenceEnabled,
      name: soupViewPersistenceKey('soup-view-stage-filter'),
    }
  );
  const [inboxFilter, setInboxFilter] = makeFlaggedPersisted(
    useEntryState<string[] | undefined>(INBOX_FILTER_ENTRY_KEY, {
      default: undefined,
    }),
    {
      enabled: filterPersistenceEnabled,
      name: soupViewPersistenceKey('soup-view-inbox-filter'),
    }
  );

  // Expose the mail view's inbox filter to consumers outside the split tree
  // (the sidebar's nested account rows read and set it by split id). The
  // provider outlives content swaps within a split, so track the live content
  // reactively and (un)register as the mail list becomes / stops being the
  // shown view — registering also flushes any filter the sidebar queued while
  // navigating here, so a sidebar inbox selection takes on the first click.
  createEffect(() => {
    const content = panel.handle.content();
    if (content.type === 'component' && content.id === 'mail') {
      const dispose = registerInboxFilterSplit(panel.handle.id, {
        inboxFilter,
        setInboxFilter,
      });
      onCleanup(dispose);
    }
  });
  const [activeTab, setActiveTab] = useEntryState<string | undefined>(
    'soup.tab',
    { default: initialTab }
  );

  createEffect(
    on(
      () => [activeListView(), activeTab()] as const,
      ([view, tabId]) => {
        if (!view || !tabId) return;
        if (!filterPersistenceEnabled()) {
          if (enabled()) changedWhilePersistenceDisabled = true;
          return;
        }

        setPersistedActiveTabs((current) => ({
          ...current,
          [view]: tabId,
        }));
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      () => [soup.predicates.andIds(), soup.predicates.orIds()] as const,
      ([and, or]) => {
        if (!enabled()) return;
        if (!filterPersistenceEnabled()) {
          changedWhilePersistenceDisabled = true;
          return;
        }

        const view = activeListView();
        if (!view) return;
        const tabId = activeTab() ?? VIEW_TAB_PRESETS[view].default;

        setPersistedPredicates((current) => ({
          ...current,
          [view]: {
            ...current[view],
            [tabId]: { and: [...and], or: [...or] },
          },
        }));
      },
      { defer: true }
    )
  );

  // The local preference can be enabled after this provider mounts. Hydrate
  // query-backed state once on the disabled -> enabled transition; entry state
  // remains the higher-priority source when navigating through split history.
  let filterPersistenceHydrated = filterPersistenceEnabled();
  createEffect(
    on(filterPersistenceEnabled, (persistenceEnabled) => {
      if (!persistenceEnabled || filterPersistenceHydrated) return;
      filterPersistenceHydrated = true;

      if (changedWhilePersistenceDisabled || config().preferInitialFilters) {
        return;
      }

      const view = activeListView();
      if (!view) return;

      const entryState = panel.handle.currentEntryState();
      const tabId = resolveTabId(
        view,
        (entryState?.['soup.tab'] as string | undefined) ??
          persistedActiveTabs()[view] ??
          activeTab()
      );
      const query =
        entryState && 'search.filters' in entryState
          ? undefined
          : persistedQueryFor(view, tabId);
      const predicates =
        entryState && 'search.predicates' in entryState
          ? undefined
          : persistedPredicatesFor(view, tabId);

      batch(() => {
        setActiveTab(tabId);
        if (query) queryFilters.replace(query);
        if (predicates) soup.predicates.set(predicates);
      });
    })
  );

  // List/board display mode — per-entry state so back/forward restores the
  // mode the user left each entry with.
  const [viewMode, setViewMode] = useEntryState<SoupViewMode>('soup.viewMode', {
    default: 'board',
  });
  const [readFilter, setReadFilter] = makeFlaggedPersisted(
    useEntryState<ReadFilter>('soup.readFilter', { default: 'all' }),
    {
      enabled: filterPersistenceEnabled,
      name: soupViewPersistenceKey('soup-view-read-filter'),
    }
  );

  // Date grouping is done client-side (see the date branch in `rows()`): the
  // backend date grouping is unreliable, and we'd rather keep paginating the
  // single flat list and regenerate buckets from whatever's loaded.
  const isClientDateGroup = createMemo(
    () => soup.grouping.activeGroupId() === 'date'
  );

  const groupByField = createMemo((): GroupByField | undefined => {
    const id = soup.grouping.activeGroupId();
    if (!id) return undefined;
    if (id === 'date') return undefined;
    if (id === 'entity_type') return { type: 'entity_type' };
    if (id === 'project') return { type: 'project' };
    if (id.startsWith('property:')) {
      return {
        type: 'property',
        propertyDefinitionId: id.slice('property:'.length),
      };
    }
    return undefined;
  });

  // Clear sub-filters when task filter is deactivated
  createEffect(() => {
    if (!soup.predicates.isActive('task')) {
      setAssigneeFilter([]);
    }
  });

  // Clear the owner/stage sub-filters when leaving the CRM company presets
  createEffect(() => {
    if (
      !soup.predicates.isActive('crm-company-active') &&
      !soup.predicates.isActive('crm-company-hidden')
    ) {
      setOwnerFilter([]);
      setStageFilter([]);
    }
  });

  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();
  const isTeamAdmin = useIsTeamAdmin();

  // Sits below `activeTab`/`userId` because the page direction comes from the
  // active tab's preset, which some views resolve against user context.
  const soupParams = createMemo(() => {
    const sortId = soup.sort.active()[0]?.id ?? 'updated_at';

    // Client-only sorts (priority, status) fall back to created_at for the API
    const sortMethod = VALID_API_SORT_METHODS.includes(sortId as ApiSortMethod)
      ? (sortId as ApiSortMethod)
      : 'created_at';

    const view = activeListView();
    // The direction and any forced sort belong to what the tab means —
    // Reminders' Active list reads soonest-first, Recent reads by the
    // user's own touches — not to the sort method state, so the preset owns
    // them. Omitted when absent so the server default (desc) applies and
    // the query keys of every existing view stay byte-identical.
    const preset = view
      ? getViewPreset(view, activeTab(), {
          userId: userId(),
          isTeamAdmin: isTeamAdmin(),
        })
      : undefined;
    const sortDirection = preset?.sortDirection;

    return {
      // Mail views use a smaller page size
      limit: view === 'mail' ? 30 : 100,
      sort_method: preset?.sortMethod ?? sortMethod,
      ...(sortDirection ? { sort_direction: sortDirection } : {}),
    };
  });

  // Active deal-stage set (team-customized when present). Drives the
  // Customers view's stage grouping, stage filter and group labels.
  const dealStages = useDealStages();

  // `resolveStage` takes the minimal company shape; widen it to any soup
  // entity (non-companies resolve to undefined since they carry no stage).
  const resolveCompanyStage = (entity: EntityData): string | undefined =>
    dealStages.resolveStage(
      entity as Parameters<typeof dealStages.resolveStage>[0]
    );

  // CRM companies come back from a dedicated soup request (not the dynamic
  // query the server-side grouped path is built on), so property grouping on
  // the Customers view buckets client-side over the flat list — same approach
  // as date grouping. `groupByField` stays populated so group headers can
  // resolve icons/labels for the grouping property.
  const isClientPropertyGroup = createMemo(
    () =>
      activeListView() === 'companies' && groupByField()?.type === 'property'
  );

  // The group-by actually sent to the backend (drives the grouped queries).
  const serverGroupByField = createMemo(() =>
    isClientPropertyGroup() || groupByField()?.type === 'date'
      ? undefined
      : groupByField()
  );

  // The inbox surfaces channel threads the current user participates in —
  // the root sender, anyone who replied, or anyone @-mentioned — via the
  // `channelThreadParticipantId` filter, since soup otherwise only surfaces
  // whole channels.
  const isInboxView = () => activeListView() === 'inbox';

  const applyInboxFilter = (state: QueryState): QueryState => {
    const inboxes = inboxFilter();
    if (inboxes === undefined) return state;
    return {
      ...state,
      include: {
        ...state.include,
        emailLinkId: inboxes.length ? inboxes : [NIL_UUID],
      },
    };
  };

  const applyInboxThreadFilter = (state: QueryState): QueryState => {
    if (!isInboxView()) {
      return {
        ...state,
        include: { ...state.include, channelThreadId: [NIL_UUID] },
      };
    }

    const id = userId();
    if (!id) return state;
    return {
      ...state,
      include: {
        ...state.include,
        channelThreadParticipantId: [id],
      },
    };
  };

  // Unread/read/all filter for the inbox: injects the per-entity-type seen
  // filters ('all' leaves them unset). Matches the experimental inbox.
  const applyInboxReadFilter = (state: QueryState): QueryState => {
    if (!isInboxView()) return state;
    const filter = readFilter();
    if (filter === 'all') return state;
    const seen = filter === 'read';
    return {
      ...state,
      include: {
        ...state.include,
        documentSeen: seen,
        emailSeen: seen,
        channelSeen: seen,
        channelThreadSeen: seen,
        chatSeen: seen,
        folderSeen: seen,
        foreignEntitySeen: seen,
      },
    };
  };

  // A row the status filter admitted stays admitted for the rest of the visit
  // (see `admittedByStatusFilter`). The inbox opens rows in a preview pane, and
  // previewing marks the row read — so without this the row the user just
  // clicked drops out from under the preview they are still reading, taking the
  // list position with it. The row re-renders in its read styling, it just keeps
  // its place.
  const entityMatchesInboxReadFilter = (entity: EntityData): boolean => {
    const filter = readFilter();
    if (filter === 'all' || !isInboxView()) return true;
    const isUnread = unreadFilterFn(entity);
    return (
      (filter === 'unread' ? isUnread : !isUnread) ||
      admittedByStatusFilter().ids.has(entity.id)
    );
  };

  const applyViewFilters = (state: QueryState): QueryState => {
    let next = applyInboxFilter(state);
    next = applyInboxThreadFilter(next);
    next = applyInboxReadFilter(next);
    return next;
  };

  const soupBody = createMemo(() =>
    compileToAst(applyViewFilters(queryFilters.state))
  );

  const [searchText, setSearchText] = useEntryState<string>('search.text', {
    default: props.initialSearchText ?? '',
  });

  // The split's effective search text — derived, never synchronized: while
  // the dock search session is open and this split is foregrounded, it IS the
  // session's query (the dock input lives in the stable app chrome — see
  // Layout — so navigation never remounts it, and the query never enters
  // per-split state: nothing to clear on close, nothing to reapply on pill
  // navigation). Otherwise it is the split's own persisted text, which only
  // the desktop search bar writes.
  const effectiveSearchText = createMemo(() =>
    isTouchDevice() && SearchState.isOpen() && panel.handle.isActive()
      ? SearchState.query()
      : searchText()
  );

  const search = createSearchState({
    soup,
    filters: () => applyViewFilters(queryFilters.state),
    assignees: assigneeFilter,
    disableLocalSearch: () => config().disableLocalSearch ?? false,
    searchPaused: sourceSearchPaused,
    searchText: effectiveSearchText,
    setSearchText,
  });

  const initialize = (options: SoupViewInitializeOptions = {}) => {
    initializing = true;
    try {
      batch(() => {
        setConfig(options);

        const entryState = panel.handle.currentEntryState();
        const entryQuery = entryState?.['search.filters'] as Query | undefined;
        const view = activeListView();
        const tabId = view
          ? resolveTabId(
              view,
              (entryState?.['soup.tab'] as string | undefined) ??
                (filterPersistenceEnabled()
                  ? persistedActiveTabs()[view]
                  : undefined)
            )
          : undefined;
        if (tabId) setActiveTab(tabId);

        const persistedQuery =
          filterPersistenceEnabled() && view && tabId
            ? persistedQueryFor(view, tabId)
            : undefined;
        const entryPredicates = entryState?.['search.predicates'] as
          | SetPredicatesInput<string>
          | undefined;
        const savedPredicates =
          filterPersistenceEnabled() && view && tabId
            ? persistedPredicatesFor(view, tabId)
            : undefined;

        queryFilters.replace(
          entryQuery ??
            (options.preferInitialFilters ? options.initialQuery : undefined) ??
            persistedQuery ??
            options.initialQuery ??
            null
        );
        soup.predicates.set(
          entryPredicates ??
            (options.preferInitialFilters
              ? options.initialClientFilters
              : undefined) ??
            savedPredicates ??
            options.initialClientFilters ??
            {}
        );
        setSearchText(options.initialSearchText ?? '');
        setEnabled(true);
      });
    } finally {
      initializing = false;
    }
  };

  const showSupportedForeignEntitiesFF = useFeatureFlag(
    ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_FLAG,
    {
      enabledOverride: ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
    }
  );
  // Create filter context for context-aware filter predicates
  const getFilterContext = (): FilterContext => ({
    userId: userId(),
    notificationSource,
    assignees: assigneeFilter(),
    owners: ownerFilter(),
    stages: stageFilter(),
    resolveCompanyStage,
  });

  // This is temporary while we are experimenting/handling
  // the migration to graphql. We should not need this since
  // the items themselves have the notifications on them. Remove
  // when completely migrated
  const attachNotifications = (entity: EntityData) =>
    withEntityNotifications(entity, notificationSource, {
      scopeChannelThreads: isInboxView(),
    });

  // Active tag option ids and combine mode, used to gate optimistic websocket
  // inserts so an active tag filter is honored even on the grouped render path.
  const activeTagOptionIds = createMemo(() =>
    (queryFilters.state.include.tagFilters ?? []).map((t) => t.value)
  );
  const activeTagFilterMode = () =>
    queryFilters.state.include.tagFilterMode ?? 'any';

  const soupItemMatchesActiveFilters = (
    item: SoupApiItem,
    view: ListView | undefined
  ): boolean => {
    if (!soupItemMatchesListView(item, view)) return false;
    if (
      !soupItemMatchesTagFilter(
        item,
        activeTagOptionIds(),
        activeTagFilterMode()
      )
    ) {
      return false;
    }

    const membershipFilter = config().itemMembershipFilter;
    if (membershipFilter && !membershipFilter(item)) return false;

    const entity = mapApiSoupItemToEntity(item) as SoupEntity;
    return (
      soup.predicates.test(entity, getFilterContext()) &&
      entityMatchesInboxReadFilter(entity)
    );
  };

  // The Soup query facade owns GraphQL eligibility and REST fallback. Its urql
  // implementation keeps loaded pages subscribed to the normalized cache.
  const itemsQuery = useSoupAstItemsQuery(
    () => ({
      params: soupParams(),
      body: soupBody(),
      groupBy: serverGroupByField(),
    }),
    () => {
      const view = activeListView();
      return {
        enabled: enabled() && !search.isSearching(),
        showSupportedForeignEntities: showSupportedForeignEntitiesFF().enabled,
        onBeforeGraphqlRefresh: () => groupQueries.resetToInitialPage(),
        meta: {
          itemFilter: (item) => soupItemMatchesActiveFilters(item, view),
        },
      };
    }
  );

  // Reading `.data` on a cold TanStack query suspends the nearest <Suspense>.
  // Read loading first so REST fallback leaves the view shell rendered.
  const itemsQueryData = () =>
    itemsQuery.isLoading ? undefined : itemsQuery.data;
  const itemsQueryHasData = () =>
    itemsQueryData() !== undefined && !itemsQuery.isPlaceholderData;
  const itemsQueryError = () =>
    itemsQuery.error ?? nativeOfflineLoadError(itemsQueryHasData);

  const itemsSource = {
    data: itemsQueryData,
    error: itemsQueryError,
    hasData: itemsQueryHasData,
    isLoading: () => itemsQuery.isLoading,
    isFetching: () => itemsQuery.isFetching,
    isPlaceholderData: () => itemsQuery.isPlaceholderData,
    isFetchingNextPage: () => itemsQuery.isFetchingNextPage,
    isEnabled: () => itemsQuery.isEnabled,
    hasNextPage: () => itemsQuery.hasNextPage,
    fetchNextPage: () => {
      void itemsQuery.fetchNextPage();
    },
  };

  const items = createMemo<SoupEntity[]>(
    (prev) => {
      const searching = search.isSearching();

      if (!searching) {
        const data = itemsSource.data();
        const extras = config().additionalEntities?.() ?? [];
        const extraEntities = extras.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];

        if (!data) {
          // Query rebinding can temporarily produce no data without an
          // error; keep the previous rows to avoid a flash on back
          // navigation. Once the active query fails, those rows belong to
          // the previous query and must go so the load-error state can
          // render — only client-local rows remain valid.
          return itemsSource.error() ? extraEntities : prev;
        }
        if (data.groups) return prev;

        const base = data.entities.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];

        if (extraEntities.length === 0) return base;

        return [...extraEntities, ...base];
      }

      const local = search.localFuzzyResults();
      const service = search.serviceSearchResults();

      const merged: SoupEntity[] = [...service, ...local];

      if (
        merged.length === 0 &&
        prev.length > 0 &&
        search.isLocalSearchSettling()
      ) {
        return prev;
      }

      for (let i = 0; i < merged.length; i++) {
        const entity = merged[i];
        if (isWithNotification(entity)) continue;
        merged[i] = attachNotifications(entity);
      }

      return merged;
    },
    [],
    {
      equals: false,
    }
  );

  // Ids that have matched the inbox status filter at some point during this
  // visit, so `entityMatchesInboxReadFilter` can keep admitting a row after the
  // user reads it.
  //
  // A visit is one view/tab/filter combination: changing any of them starts a
  // new set, and returning a new object is what re-runs every consumer. An
  // effect that emptied the set in place would not — a plain Set notifies
  // nothing — and the list would keep rendering the previous visit's rows.
  const admittedByStatusFilter = createMemo<{
    scope: string;
    ids: Set<string>;
  }>((prev) => {
    const filter = readFilter();
    const scope = `${activeListView()}:${activeTab()}:${filter}`;
    const ids = prev?.scope === scope ? new Set(prev.ids) : new Set<string>();

    if (filter !== 'all' && isInboxView()) {
      const wantUnread = filter === 'unread';
      for (const entity of items()) {
        if (unreadFilterFn(entity) === wantUnread) ids.add(entity.id);
      }
    }

    return { scope, ids };
  });

  const baseEntities = () => {
    let transformed = items();
    const ctx = getFilterContext();
    const tagOptionIds = activeTagOptionIds();
    const tagFilterMode = activeTagFilterMode();

    const next = [];
    for (const entity of transformed) {
      if (!soup.predicates.test(entity, ctx)) {
        continue;
      }
      if (!entityMatchesInboxReadFilter(entity)) {
        continue;
      }
      if (!entityMatchesTagFilter(entity, tagOptionIds, tagFilterMode)) {
        continue;
      }
      next.push(entity);
    }

    transformed = deduplicateEntities(next);

    const sorts = soup.sort.active();
    if (sorts.length > 0 && !search.isSearching()) {
      transformed.sort((a, b) => {
        for (const sort of sorts) {
          const result = sort.fn(a, b);
          if (result !== 0) return result;
        }
        return 0;
      });
    }

    return transformed;
  };

  const entities = () => {
    const base = baseEntities();
    if (!ENABLE_FEATURED_SEARCH_RESULTS || !search.isSearching()) return base;

    const featuredIds = search.featuredIds();
    if (featuredIds.length === 0) return base;

    const entityMap = new Map(base.map((e) => [e.id, e]));
    const featuredIdSet = new Set(featuredIds);
    const featured: SoupEntity[] = [];

    for (const id of featuredIds) {
      const e = entityMap.get(id);
      if (e) featured.push(e);
    }

    const rest = base.filter((e) => !featuredIdSet.has(e.id));

    return [...featured, ...rest];
  };

  const groupQueries = createGroupedSoupQueries({
    initialPage: createMemo(() => {
      if (itemsSource.isPlaceholderData()) return;

      const groups = itemsSource.data()?.groups;
      const items = itemsSource.data()?.itemsById;
      if (!groups || !items) return;
      return { groups, items };
    }),
    groupByField: serverGroupByField,
    soupParams,
    soupBody,
    transport: () => itemsQuery.transport,
    queryOptions: () => {
      const view = activeListView();
      return {
        enabled: enabled() && !search.isSearching(),
        meta: {
          itemFilter: (item) => soupItemMatchesActiveFilters(item, view),
        },
      };
    },
  });

  const groupQueryFor = (groupKey: string) => groupQueries.map().get(groupKey);

  const fetchNextGroupPage = async (groupKey: string) => {
    await groupQueryFor(groupKey)?.fetchNextPage();
  };

  const isFetchingGroupPage = (groupKey: string) =>
    groupQueryFor(groupKey)?.isFetchingNextPage() ?? false;

  const hasNextGroupPage = (groupKey: string) =>
    groupQueryFor(groupKey)?.hasNextPage() ?? false;

  // True when grouping by the canonical Stage id (the "group by Stage"
  // presets always use the system definition id, even when the team's own
  // stage set is active).
  const isStageGrouping = () => {
    const field = groupByField();
    return (
      field?.type === 'property' &&
      field.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STAGE
    );
  };

  const isOwnerGrouping = () => {
    const field = groupByField();
    return (
      field?.type === 'property' &&
      field.propertyDefinitionId === SYSTEM_PROPERTY_IDS.COMPANY_OWNER
    );
  };

  // Group-key → label, preferring the active deal-stage set for stage
  // groupings (custom option ids are unknown to the static option table).
  const resolveGroupLabel = (key: string): string | undefined => {
    if (isStageGrouping()) {
      return dealStages.stageLabel(key) ?? getPropertyOptionLabel(key);
    }
    // Owner group keys are user ids — resolve to the display name.
    if (isOwnerGrouping()) {
      return idToDisplayName(key) || undefined;
    }
    return getPropertyOptionLabel(key);
  };

  const buildGroupMeta = (group: ApiGroupMeta): GroupMeta => {
    const resolvedLabel = resolveGroupLabel(group.key) ?? group.label;
    return {
      key: group.key,
      value: group.key,
      label: resolvedLabel,
      count: group.totalCount,
      isExpanded: () => soup.grouping.isExpanded(group.key),
      toggle: () => soup.grouping.toggle(group.key),
    };
  };

  // Group key an entity falls under for a property grouping: the first
  // select-option id / entity-reference id, or '' for "Not set".
  const clientPropertyGroupKey = (
    entity: SoupEntity,
    propertyDefinitionId: string
  ): string => {
    const properties = 'properties' in entity ? (entity.properties ?? []) : [];
    const property = properties.find(
      (p) => p.definition.id === propertyDefinitionId
    );
    const value = property?.value;
    if (!value) return '';
    if (value.type === 'SelectOption' || value.type === 'Link') {
      const first = value.value[0];
      return typeof first === 'string' ? first : '';
    }
    if (value.type === 'EntityReference') {
      const first = value.value[0];
      return first && typeof first === 'object' && 'entity_id' in first
        ? String(first.entity_id)
        : '';
    }
    return '';
  };

  const builtRows = createMemo((): SoupRow[] => {
    const field = groupByField();
    const groups = itemsSource.data()?.groups;

    // Client-side property grouping (Customers view): bucket the flat
    // (paginated) list by property value; option order comes from the
    // statically-known stage options, then label, with "Not set" last.
    if (enabled() && isClientPropertyGroup() && !search.isSearching()) {
      const definitionId =
        field?.type === 'property' ? field.propertyDefinitionId : '';
      // Stage grouping resolves through the active deal-stage set so legacy
      // system-stage values land in the matching custom-stage bucket.
      const isStage = definitionId === SYSTEM_PROPERTY_IDS.STAGE;
      const buckets = new Map<string, SoupEntity[]>();
      for (const entity of entities()) {
        const key = isStage
          ? (resolveCompanyStage(entity) ?? '')
          : clientPropertyGroupKey(entity, definitionId);
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(entity);
        } else {
          buckets.set(key, [entity]);
        }
      }

      const stageOrder = isStage
        ? dealStages.stages().map((stage) => stage.id)
        : COMPANY_STAGE_OPTIONS.map((o) => o.value as string);
      const order = [...buckets.keys()].sort((a, b) => {
        if (a === '') return 1;
        if (b === '') return -1;
        const aStage = stageOrder.indexOf(a);
        const bStage = stageOrder.indexOf(b);
        if (aStage !== -1 || bStage !== -1) {
          return (
            (aStage === -1 ? stageOrder.length : aStage) -
            (bStage === -1 ? stageOrder.length : bStage)
          );
        }
        const aLabel = resolveGroupLabel(a) ?? a;
        const bLabel = resolveGroupLabel(b) ?? b;
        return aLabel.localeCompare(bLabel);
      });

      const groupedRows: SoupRow[] = [];
      let index = 0;
      for (const key of order) {
        const groupEntities = buckets.get(key)!;
        const groupMeta: GroupMeta = {
          key,
          value: key,
          label: key === '' ? 'Not set' : (resolveGroupLabel(key) ?? key),
          count: groupEntities.length,
          isExpanded: () => soup.grouping.isExpanded(key),
          toggle: () => soup.grouping.toggle(key),
        };
        groupedRows.push(
          soup.buildRow({
            id: `header:${key}`,
            index: index++,
            original: groupEntities[0],
            group: groupMeta,
            isGrouped: true,
          })
        );
        for (const entity of groupEntities) {
          groupedRows.push(
            soup.buildRow({
              id: entity.id,
              index: index++,
              original: entity,
              group: groupMeta,
            })
          );
        }
      }
      return groupedRows;
    }

    // Client-side date grouping: reuse the single flat (paginated) list and
    // regenerate date buckets from whatever's loaded — no per-group fetching.
    if (enabled() && isClientDateGroup() && !search.isSearching()) {
      const all = entities();
      const buckets = new Map<
        string,
        { label: string; entities: SoupEntity[] }
      >();
      const order: string[] = [];
      const now = new Date();

      for (const entity of all) {
        const ts = entity.sortTs ?? entity.updatedAt ?? entity.createdAt;
        const bucket = dateBucket(ts, now);
        let group = buckets.get(bucket.key);

        if (!group) {
          group = { label: bucket.label, entities: [] };
          buckets.set(bucket.key, group);
          order.push(bucket.key);
        }

        group.entities.push(entity);
      }

      const dateRows: SoupRow[] = [];
      let index = 0;
      for (const key of order) {
        const group = buckets.get(key)!;
        const groupMeta: GroupMeta = {
          key,
          value: key,
          label: group.label,
          count: group.entities.length,
          isExpanded: () => soup.grouping.isExpanded(key),
          toggle: () => soup.grouping.toggle(key),
        };
        dateRows.push(
          soup.buildRow({
            id: `header:${key}`,
            index: index++,
            original: group.entities[0],
            group: groupMeta,
            isGrouped: true,
          })
        );
        for (const entity of group.entities) {
          dateRows.push(
            soup.buildRow({
              id: entity.id,
              index: index++,
              original: entity,
              group: groupMeta,
            })
          );
        }
      }
      return dateRows;
    }

    if (!enabled() || !field || !groups || search.isSearching()) {
      return entities().map((entity, index) =>
        soup.buildRow({ id: entity.id, index, original: entity })
      );
    }

    const result: SoupRow[] = [];
    let globalIndex = 0;

    for (const apiGroup of groups) {
      const groupMeta = buildGroupMeta(apiGroup);
      const groupData = groupQueryFor(apiGroup.key)?.data();
      const groupEntities =
        groupData?.entities?.map(
          (entity) =>
            (isWithNotification(entity)
              ? entity
              : attachNotifications(entity)) as SoupEntity
        ) ?? [];

      const firstEntity = groupEntities[0];
      if (!firstEntity) continue;

      result.push(
        soup.buildRow({
          id: `header:${apiGroup.key}`,
          index: globalIndex++,
          original: firstEntity,
          group: groupMeta,
          isGrouped: true,
        })
      );

      for (const entity of groupEntities) {
        result.push(
          soup.buildRow({
            id: entity.id,
            index: globalIndex++,
            original: entity,
            group: groupMeta,
          })
        );
      }

      if (!hasNextGroupPage(apiGroup.key)) continue;

      const lastEntity = groupEntities[groupEntities.length - 1];
      result.push(
        soup.buildRow({
          id: `loadmore:${apiGroup.key}`,
          index: globalIndex++,
          original: lastEntity,
          group: groupMeta,
          isLoadMore: true,
        })
      );
    }

    return result;
  });

  const { searchQuery } = search;
  const searchSourceHasData = () =>
    (searchQuery.data !== undefined && !searchQuery.isPlaceholderData) ||
    (!searchQuery.isPlaceholderData && entities().length > 0);
  const searchSourceError = () =>
    (searchQuery.error as Error | null) ??
    nativeOfflineLoadError(searchSourceHasData);

  const context = {
    soup,
    initialize,
    source: {
      data: entities,
      error: () =>
        search.isSearching() ? searchSourceError() : itemsSource.error(),
      hasData: () =>
        search.isSearching()
          ? searchSourceHasData()
          : itemsSource.hasData() ||
            // Rows retained across a query rebind count as data so the view
            // doesn't flash, but once the query errors only client-local
            // rows remain and must not suppress the load-error state.
            (!itemsSource.error() &&
              !itemsSource.isPlaceholderData() &&
              entities().length > 0),
      isLoading: () => itemsSource.isLoading(),
      isFetching: () => itemsSource.isFetching() || searchQuery.isFetching,
      isPlaceholderData: () =>
        itemsSource.isPlaceholderData() && !search.isSearching(),
      isFetchingNextPage: () =>
        itemsSource.isFetchingNextPage() || searchQuery.isFetchingNextPage,
      hasNextPage: () => {
        if (!enabled()) return false;

        return (
          (itemsSource.isEnabled() && itemsSource.hasNextPage()) ||
          (searchQuery.isEnabled && searchQuery.hasNextPage)
        );
      },
      fetchNextPage: () => {
        if (!enabled()) return;

        if (itemsSource.isEnabled()) {
          itemsSource.fetchNextPage();
        }
        if (searchQuery.isEnabled) {
          searchQuery.fetchNextPage();
        }
      },
      refresh: async () => {
        if (!enabled()) return;

        resetToInitialPage();

        await Promise.all([
          queryClient.invalidateQueries(
            { queryKey: soupKeys._def },
            // Reject on refetch failure so pull-to-refresh can surface it
            // instead of retracting as if the refresh succeeded.
            { throwOnError: true }
          ),
          // urql pages are outside the TanStack cache invalidation above.
          itemsQuery.transport === 'graphql'
            ? itemsQuery.refresh()
            : Promise.resolve(),
          invalidateUserNotifications(),
        ]);
      },
    },
    items,
    rows: soup.rows,
    searchText: search.searchText,
    setSearchText: search.setSearchText,
    searchPaused: sourceSearchPaused,
    setSearchPaused,
    featuredIds: search.featuredIds,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
    queryFilters,
    restorePersistedQueryFilters,
    restorePersistedPredicates,
    tagFilter,
    filterByTag,
    assigneeFilter,
    setAssigneeFilter,
    ownerFilter,
    setOwnerFilter,
    stageFilter,
    setStageFilter,
    inboxFilter,
    setInboxFilter,
    activeTab,
    setActiveTab,
    getPersistedActiveTab,
    viewMode,
    setViewMode,
    readFilter,
    setReadFilter,
    groupByField,
    fetchNextGroupPage,
    isFetchingGroupPage,
    hasNextGroupPage,
  };

  return (
    <SoupViewContext.Provider value={context}>
      {props.children}
      <Suspense>
        <SyncWithSoup soup={soup} rows={builtRows()} />
      </Suspense>
    </SoupViewContext.Provider>
  );
};

interface SyncWithSoupProps {
  soup: SoupState;
  rows: SoupRow[];
}

const SyncWithSoup = (props: SyncWithSoupProps) => {
  createRenderEffect(on(() => props.rows, props.soup.setRows));

  return null;
};
