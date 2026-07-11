import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
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
import { createGroupedSoupQueries } from '@app/features/next-soup/soup-view/create-grouped-soup-queries';
import { createSearchState } from '@app/features/next-soup/soup-view/create-search-state';
import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import {
  INBOX_FILTER_ENTRY_KEY,
  registerInboxFilterSplit,
} from '@app/features/next-soup/soup-view/inbox-filter-controllers';
import {
  deduplicateEntities,
  scopeChannelNotificationsForEntity,
} from '@app/features/next-soup/utils';
import { useEntryState } from '@components/app/split-layout/entry-state';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  entityMatchesTagFilter,
  isListViewID,
  type ListView,
  soupItemMatchesListView,
  soupItemMatchesTagFilter,
} from '@app/constants/list-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useDealStages } from '@companies/crm/deal-stages';
import {
  ENABLE_FEATURED_SEARCH_RESULTS,
  ENABLE_GRAPHQL_SOUP_FLAG,
  ENABLE_GRAPHQL_SOUP_OVERRIDE,
  ENABLE_NEW_INBOX_FLAG,
  ENABLE_NEW_INBOX_OVERRIDE,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_FLAG,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import {
  COMPANY_STAGE_OPTIONS,
  type EntityData,
  getPropertyOptionLabel,
  isWithNotification,
  toNotificationEntity,
} from '@entity';
import { useNotificationsForEntity } from '@notifications';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useQueryClient } from '@queries/client';
import { invalidateUserNotifications } from '@queries/notification/user-notifications';
import type {
  GroupMeta as ApiGroupMeta,
  GroupByField,
} from '@queries/soup/grouped/types';
import type { SoupParams } from '@queries/soup/items';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { soupKeys } from '@queries/soup/keys';
import { useReactiveSoupAstItemsQuery } from '@queries/soup/reactive-items';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import type { SoupApiItem, SoupPage } from '@service-storage/generated/schemas';
import type { InfiniteData } from '@tanstack/solid-query';
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
  disableLocalSearch?: boolean;
  additionalEntities?: Accessor<EntityData[]>;
};

export type ReadFilter = 'all' | 'unread' | 'read';

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
  previewOpen: Accessor<boolean>;
  setPreviewOpen: Setter<boolean>;
  isSearchServiceLoading: Accessor<boolean>;
  isLocalSearchSettling: Accessor<boolean>;
  queryFilters: QueryStore;
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

type ApiSortMethod = Exclude<
  NonNullable<SoupParams['sort_method']>,
  'frecency'
>;
const VALID_API_SORT_METHODS: ApiSortMethod[] = [
  'viewed_at',
  'created_at',
  'updated_at',
  'viewed_updated',
];

export const SoupViewContextProvider: FlowComponent<
  SoupViewContextProviderProps
> = (props) => {
  const soup = props.soup ?? createSoupState();
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [enabled, setEnabled] = createSignal(props.initialEnabled ?? false);
  const [config, setConfig] = createSignal<SoupViewInitializeOptions>({
    initialQuery: props.initialQuery,
    initialClientFilters: props.initialClientFilters,
    initialSearchText: props.initialSearchText,
    disableLocalSearch: props.disableLocalSearch,
    additionalEntities: props.additionalEntities,
  });

  const queryClient = useQueryClient();
  const useGraphqlSoupFF = useFeatureFlag(ENABLE_GRAPHQL_SOUP_FLAG, {
    enabledOverride: ENABLE_GRAPHQL_SOUP_OVERRIDE,
  });
  const resolveTransport = (groupBy: GroupByField | undefined) =>
    useGraphqlSoupFF().enabled && !groupBy ? 'graphql' : undefined;

  const soupParams = createMemo(() => {
    const sortId = soup.sort.active()[0]?.id ?? 'updated_at';

    // Client-only sorts (priority, status) fall back to created_at for the API
    const sortMethod = VALID_API_SORT_METHODS.includes(sortId as ApiSortMethod)
      ? (sortId as ApiSortMethod)
      : 'created_at';

    return {
      limit: 100,
      sort_method: sortMethod,
    };
  });

  const panel = useSplitPanelOrThrow();

  const store = createQueryStore({
    initial: props.initialQuery,
  });

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

  const trimToFirstPage = () => {
    const groupBy = serverGroupByField();

    // Reactive urql path keeps its own page list (no-op when inactive or
    // already on one page). Defined below; only invoked at runtime.
    reactiveItemsQuery.trimToFirstPage();

    queryClient.setQueryData(
      soupKeys.astItems({
        params: soupParams(),
        body: soupBody(),
        groupBy,
        transport: resolveTransport(groupBy),
      }).queryKey,
      (prev: InfiniteData<SoupPage> | SoupPage | undefined) => {
        if (!prev) return;
        if ('pages' in prev) {
          prev.pages.splice(1, prev.pages.length);
          return prev;
        }
        return prev;
      }
    );
  };

  const queryFilters: QueryStore = {
    ...store,
    set: (query) => {
      trimToFirstPage();
      store.set(query);
    },
    replace: (query) => {
      trimToFirstPage();
      store.replace(query);
    },
    add: (query) => {
      trimToFirstPage();
      store.add(query);
    },
    remove: (query) => {
      trimToFirstPage();
      store.remove(query);
    },
  };

  const [searchPaused, setSearchPaused] = createSignal(false);
  const sourceSearchPaused = createMemo(() => searchPaused() || !enabled());
  const [assigneeFilter, setAssigneeFilter] = useEntryState<string[]>(
    'soup.assigneeFilter',
    { default: [] }
  );
  const [ownerFilter, setOwnerFilter] = useEntryState<string[]>(
    'soup.ownerFilter',
    { default: [] }
  );
  const [stageFilter, setStageFilter] = useEntryState<string[]>(
    'soup.stageFilter',
    { default: [] }
  );
  const [inboxFilter, setInboxFilter] = useEntryState<string[] | undefined>(
    INBOX_FILTER_ENTRY_KEY,
    { default: undefined }
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
    { default: undefined }
  );
  const [readFilter, setReadFilter] = useEntryState<ReadFilter>(
    'soup.readFilter',
    { default: 'unread' }
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

  // Active deal-stage set (team-customized when present). Drives the
  // Customers view's stage grouping, stage filter and group labels.
  const dealStages = useDealStages();

  // `resolveStage` takes the minimal company shape; widen it to any soup
  // entity (non-companies resolve to undefined since they carry no stage).
  const resolveCompanyStage = (entity: EntityData): string | undefined =>
    dealStages.resolveStage(
      entity as Parameters<typeof dealStages.resolveStage>[0]
    );

  const activeListView = createMemo<ListView | undefined>(() => {
    const content = panel.handle.content();
    if (content.type !== 'component') return;
    return isListViewID(content.id) ? content.id : undefined;
  });

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
    isClientPropertyGroup() ? undefined : groupByField()
  );

  // The new inbox surfaces channel threads the current user participates in —
  // the root sender, anyone who replied, or anyone @-mentioned — via the
  // `channelThreadParticipantId` filter, since soup otherwise only surfaces
  // whole channels.
  const newInboxFlag = useFeatureFlag(ENABLE_NEW_INBOX_FLAG, {
    enabledOverride: ENABLE_NEW_INBOX_OVERRIDE,
  });
  const isNewInbox = () =>
    activeListView() === 'inbox' && newInboxFlag().enabled;

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
    if (!isNewInbox()) {
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

  // Unread/read/all filter for the new inbox: injects the per-entity-type seen
  // filters ('all' leaves them unset). Matches the experimental inbox.
  const applyInboxReadFilter = (state: QueryState): QueryState => {
    if (!isNewInbox()) return state;
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
        // channelThreadSeen: seen,
        chatSeen: seen,
        folderSeen: seen,
        foreignEntitySeen: seen,
      },
    };
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

  const search = createSearchState({
    soup,
    filters: () => applyViewFilters(queryFilters.state),
    assignees: assigneeFilter,
    disableLocalSearch: () => config().disableLocalSearch ?? false,
    searchPaused: sourceSearchPaused,
    searchText,
    setSearchText,
  });

  const initialize = (options: SoupViewInitializeOptions = {}) => {
    batch(() => {
      setConfig(options);
      queryFilters.replace(options.initialQuery ?? null);
      soup.predicates.set(options.initialClientFilters ?? {});
      setSearchText(options.initialSearchText ?? '');
      setEnabled(true);
    });
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

  const attachNotifications = (entity: EntityData) => {
    const notifications = useNotificationsForEntity(
      notificationSource,
      toNotificationEntity(entity)
    );
    return {
      ...entity,
      notifications: () =>
        isNewInbox()
          ? scopeChannelNotificationsForEntity(entity, notifications())
          : notifications(),
    };
  };

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

    return soup.predicates.test(
      mapApiSoupItemToEntity(item) as SoupEntity,
      getFilterContext()
    );
  };

  // Reactive urql path (same `enable-graphql-soup` flag as the transport):
  // the flat soup list subscribes to the GraphQL query directly, so
  // normalized-cache pushes (optimistic property writes, sibling writes,
  // other tabs) re-render without a TanStack invalidation round-trip.
  // Grouped views and ASTs without a GraphQL translation stay on TanStack.
  const reactiveEligible = () =>
    useGraphqlSoupFF().enabled && !serverGroupByField();

  const reactiveItemsQuery = useReactiveSoupAstItemsQuery(
    () => ({ params: soupParams(), body: soupBody() }),
    () => ({
      enabled: enabled() && !search.isSearching() && reactiveEligible(),
      showSupportedForeignEntities: showSupportedForeignEntitiesFF().enabled,
    })
  );

  const reactiveActive = () =>
    reactiveEligible() && reactiveItemsQuery.isSupported();

  const itemsQuery = useSoupAstItemsQuery(
    () => {
      const groupBy = serverGroupByField();
      return {
        params: soupParams(),
        body: soupBody(),
        groupBy,
        transport: resolveTransport(groupBy),
      };
    },
    () => {
      const view = activeListView();
      return {
        enabled: enabled() && !search.isSearching() && !reactiveActive(),
        showSupportedForeignEntities: showSupportedForeignEntitiesFF().enabled,
        meta: {
          itemFilter: (item) => soupItemMatchesActiveFilters(item, view),
        },
      };
    }
  );

  /**
   * Unified soup items surface: the reactive urql query when active, the
   * TanStack infinite query otherwise. Grouped data (`groups`/`itemsById`)
   * only ever comes from the TanStack side — grouping is never reactive.
   */
  const itemsSource = {
    data: () =>
      reactiveActive() ? reactiveItemsQuery.data() : itemsQuery.data,
    isLoading: () =>
      reactiveActive() ? reactiveItemsQuery.isLoading() : itemsQuery.isLoading,
    isFetching: () =>
      reactiveActive()
        ? reactiveItemsQuery.isFetching()
        : itemsQuery.isFetching,
    isPlaceholderData: () =>
      reactiveActive() ? false : itemsQuery.isPlaceholderData,
    isFetchingNextPage: () =>
      reactiveActive()
        ? reactiveItemsQuery.isFetchingNextPage()
        : itemsQuery.isFetchingNextPage,
    isEnabled: () =>
      reactiveActive()
        ? enabled() && !search.isSearching()
        : itemsQuery.isEnabled,
    hasNextPage: () =>
      reactiveActive()
        ? reactiveItemsQuery.hasNextPage()
        : itemsQuery.hasNextPage,
    fetchNextPage: () => {
      if (reactiveActive()) {
        reactiveItemsQuery.fetchNextPage();
      } else {
        itemsQuery.fetchNextPage();
      }
    },
  };

  const items = createMemo<SoupEntity[]>(
    (prev) => {
      const searching = search.isSearching();

      if (!searching) {
        const data = itemsSource.data();

        if (!data || data.groups) return prev;

        const base = data.entities.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];

        const extras = config().additionalEntities?.() ?? [];

        if (extras.length === 0) return base;

        const extraEntities = extras.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];

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
        if (entity.notifications) continue;
        merged[i] = attachNotifications(entity);
      }

      return merged;
    },
    [],
    {
      equals: false,
    }
  );

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
      if (itemsQuery.isPlaceholderData) return;

      const groups = itemsQuery.data?.groups;
      const items = itemsQuery.data?.itemsById;
      if (!groups || !items) return;
      return { groups, items };
    }),
    groupByField: serverGroupByField,
    soupParams,
    soupBody,
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

  // Group-key → label, preferring the active deal-stage set for stage
  // groupings (custom option ids are unknown to the static option table).
  const resolveGroupLabel = (key: string): string | undefined => {
    if (isStageGrouping()) {
      return dealStages.stageLabel(key) ?? getPropertyOptionLabel(key);
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

  const rows = createMemo((): SoupRow[] => {
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

  const context = {
    soup,
    initialize,
    source: {
      data: entities,
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

        trimToFirstPage();

        await Promise.all([
          queryClient.invalidateQueries(
            { queryKey: soupKeys._def },
            // Reject on refetch failure so pull-to-refresh can surface it
            // instead of retracting as if the refresh succeeded.
            { throwOnError: true }
          ),
          // The reactive urql page refetches from the network directly;
          // it is outside the TanStack cache the invalidation reaches.
          reactiveActive() ? reactiveItemsQuery.refresh() : Promise.resolve(),
          invalidateUserNotifications(),
        ]);
      },
    },
    items,
    rows,
    previewOpen,
    setPreviewOpen,
    searchText: search.searchText,
    setSearchText: search.setSearchText,
    searchPaused: sourceSearchPaused,
    setSearchPaused,
    featuredIds: search.featuredIds,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
    queryFilters,
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
        <SyncWithSoup soup={soup} rows={rows()} />
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
