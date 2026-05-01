import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  createSoupState,
  type SoupState,
} from '@app/component/next-soup/create-soup-state';
import { createSearchState } from '@app/component/next-soup/soup-view/create-search-state';
import { deduplicateEntities } from '@app/component/next-soup/utils';
import {
  isWithNotification,
  type EntityData,
  type WithNotification,
  type WithSearch,
} from '@entity';
import { ENABLE_FEATURED_SEARCH_RESULTS } from '@core/constant/featureFlags';
import { useNotificationsForEntity } from '@notifications';
import { type SoupParams, useSoupAstItemsQuery } from '@queries/soup/items';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  type FlowComponent,
  on,
  type Setter,
  Suspense,
  useContext,
} from 'solid-js';
import type { FilterContext } from '@app/component/next-soup/filters/configs/';
import {
  createQueryStore,
  type Query,
  type QueryStore,
} from '@app/component/next-soup/filters/filter-store/query-store';
import { useUserId } from '@core/context/user';
import { useQueryClient } from '@queries/client';
import { soupKeys } from '@queries/soup/keys';
import type { InfiniteData } from '@tanstack/solid-query';
import type { SoupPage } from '@service-storage/generated/schemas';

type Row<T> = {
  original: T;
  id: string;
  depth: number;
  isSelected: () => boolean;
  isExpanded: () => boolean;
  isGrouped: () => boolean;
  isFocused: () => boolean;
  toggleExpanded: (expanded?: boolean) => void;
};

export type SoupRow = Row<SoupEntity>;

export type SoupEntity = WithNotification<EntityData | WithSearch<EntityData>>;

type DataSource<T> = {
  data: Accessor<T[]>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  hasNextPage: Accessor<boolean>;
  fetchNextPage: VoidFunction;
};

interface SoupViewContextValues {
  soup: SoupState;
  source: DataSource<EntityData>;
  searchText: Accessor<string>;
  setSearchText: (value: string) => void;
  searchPaused: Accessor<boolean>;
  setSearchPaused: Setter<boolean>;
  searchMentions: Accessor<string[]>;
  setSearchMentions: Setter<string[]>;
  featuredIds: Accessor<string[]>;
  rows: Accessor<SoupRow[]>;
  isSearchServiceLoading: Accessor<boolean>;
  isLocalSearchSettling: Accessor<boolean>;
  queryFilters: QueryStore;
  assigneeFilter: Accessor<string[]>;
  setAssigneeFilter: Setter<string[]>;
  activeTab: Accessor<string | undefined>;
  setActiveTab: Setter<string | undefined>;
}

export const SoupViewContext = createContext<SoupViewContextValues>();

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

interface SoupViewContextProviderProps {
  soup?: SoupState;
  initialQuery?: Query;
  initialSearchText?: string;
  disableLocalSearch?: boolean;
  /**
   * Additional client-side entities to merge into the soup item stream.
   * Visibility is still controlled by the active client filters.
   */
  additionalEntities?: Accessor<EntityData[]>;
}

type ApiSortMethod = NonNullable<SoupParams['sort_method']>;
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

  const queryClient = useQueryClient();

  const soupParams = createMemo((): SoupParams => {
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

  const store = createQueryStore({ initial: props.initialQuery });

  const invalidateCache = () => {
    queryClient.setQueryData(
      soupKeys.astItems({
        params: soupParams(),
        body: soupBody(),
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
      invalidateCache();
      store.set(query);
    },
    replace: (query) => {
      invalidateCache();
      store.replace(query);
    },
    add: (query) => {
      invalidateCache();
      store.add(query);
    },
    remove: (query) => {
      invalidateCache();
      store.remove(query);
    },
  };

  const [searchPaused, setSearchPaused] = createSignal(false);
  const [searchMentions, setSearchMentions] = createSignal<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = createSignal<string[]>([]);
  const [activeTab, setActiveTab] = createSignal<string | undefined>(undefined);

  // Clear sub-filters when task filter is deactivated
  createEffect(() => {
    if (!soup.predicates.isActive('task')) {
      setAssigneeFilter([]);
    }
  });

  // soupBody is derived from the query filter store's compiled AST
  const soupBody = createMemo(() => queryFilters.compile());

  const search = createSearchState({
    soup,
    filters: () => queryFilters.state,
    assignees: assigneeFilter,
    disableLocalSearch: props.disableLocalSearch,
    searchPaused,
    searchMentions,
    initialText: props.initialSearchText,
  });

  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  // Create filter context for context-aware filter predicates
  const getFilterContext = (): FilterContext => ({
    userId: userId(),
    notificationSource,
    assignees: assigneeFilter(),
  });

  const attachNotifications = (entity: EntityData) => {
    return {
      ...entity,
      notifications: useNotificationsForEntity(notificationSource, entity),
    };
  };

  const attachMethods = (
    entity: WithNotification<EntityData>,
    depth = 0
  ): SoupRow => {
    return {
      original: entity,
      id: entity.id,
      depth,
      isFocused() {
        return soup.focus.id() === entity.id;
      },
      isSelected() {
        return soup.selection.isSelected(entity.id);
      },
      isGrouped() {
        return false;
      },
      isExpanded() {
        return soup.selection.isSelected(entity.id);
      },
      toggleExpanded() {
        return soup.selection.isSelected(entity.id);
      },
    };
  };

  const itemsQuery = useSoupAstItemsQuery(
    () => ({
      params: soupParams(),
      body: soupBody(),
    }),
    () => ({
      enabled: !search.isSearching(),
    })
  );

  const items = createMemo<SoupEntity[]>(
    (prev) => {
      const searching = search.isSearching();

      if (!searching) {
        const data = itemsQuery.data;
        if (!data) return prev;
        const base = data.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];
        const extras = props.additionalEntities?.() ?? [];
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

    const next = [];
    for (const entity of transformed) {
      if (!soup.predicates.test(entity, ctx)) {
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

  const rows = createMemo(() => {
    return entities().map((e) => attachMethods(e));
  });

  const { searchQuery } = search;

  const context = {
    soup,
    source: {
      data: entities,
      isLoading: () => itemsQuery.isLoading,
      isFetching: () => itemsQuery.isFetching || searchQuery.isFetching,
      isFetchingNextPage: () =>
        itemsQuery.isFetchingNextPage || searchQuery.isFetchingNextPage,
      hasNextPage: () => {
        return (
          (itemsQuery.isEnabled && itemsQuery.hasNextPage) ||
          (searchQuery.isEnabled && searchQuery.hasNextPage)
        );
      },
      fetchNextPage: () => {
        if (itemsQuery.isEnabled) {
          itemsQuery.fetchNextPage();
        }
        if (searchQuery.isEnabled) {
          searchQuery.fetchNextPage();
        }
      },
    },
    rows,
    searchText: search.searchText,
    setSearchText: search.setSearchText,
    searchPaused,
    setSearchPaused,
    searchMentions,
    setSearchMentions,
    featuredIds: search.featuredIds,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
    queryFilters,
    assigneeFilter,
    setAssigneeFilter,
    activeTab,
    setActiveTab,
  };

  return (
    <SoupViewContext.Provider value={context}>
      {props.children}
      <Suspense>
        <SyncWithSoup soup={soup} entities={entities()} />
      </Suspense>
    </SoupViewContext.Provider>
  );
};

interface SyncWithSoupProps {
  soup: SoupState;
  entities: SoupEntity[];
}

const SyncWithSoup = (props: SyncWithSoupProps) => {
  createRenderEffect(on(() => props.entities, props.soup.setData));

  return null;
};
