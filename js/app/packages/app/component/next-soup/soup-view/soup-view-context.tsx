import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  createSoupState,
  type SoupState,
} from '@app/component/next-soup/create-soup-state';
import {
  type FilterID,
  getFolderFileTypes,
} from '@app/component/next-soup/filters/filters';
import { sortEntitiesForSearch } from '@app/component/next-soup/soup-view/sort-options';
import { deduplicateEntities } from '@app/component/next-soup/utils';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyMatch } from '@core/util/fuzzy';
import { mergeAdjacentMacroEmTags } from '@core/util/searchHighlight';
import type { EntityData, WithNotification, WithSearch } from '@entity';
import { useNotificationsForEntity } from '@notifications';
import {
  type SoupItemsQueryFilters,
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { useSearchSoupQuery } from '@queries/soup/search';
import type {
  UnifiedSearchIndex,
  UnifiedSearchRequest,
} from '@service-search/generated/models';
import {
  type Accessor,
  createContext,
  createMemo,
  createRenderEffect,
  createSignal,
  type FlowComponent,
  on,
  type Setter,
  Suspense,
  useContext,
} from 'solid-js';
import { isWithNotification } from '@entity';

import { match } from 'ts-pattern';

const SEARCH_SERVICE_DEBOUNCE_MS = 300;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const CHANNEL_PRELOAD_ARGS: SoupItemsQueryArgs = {
  params: { limit: 500, sort_method: 'updated_at' },
  body: {
    chat_filters: { chat_ids: [NIL_UUID] },
    document_filters: { document_ids: [NIL_UUID] },
    email_filters: { recipients: [NIL_UUID] },
    project_filters: { project_ids: [NIL_UUID] },
    channel_filters: {
      channel_types: [],
    },
  },
};

function mergeEntityPools(
  items: EntityData[],
  extra: EntityData[]
): EntityData[] {
  if (extra.length === 0) return items;
  const existingIds = new Set(items.map((e) => e.id));
  const newItems = extra.filter((e) => !existingIds.has(e.id));
  if (newItems.length === 0) return items;
  return [...items, ...newItems];
}

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
  isSearchDisabled: Accessor<boolean>;
  rows: Accessor<SoupRow[]>;
  queryFilters: Accessor<SoupItemsQueryFilters>;
  setQueryFilters: Setter<SoupItemsQueryFilters>;
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
  queryFilters?: SoupItemsQueryFilters;
}

export const SoupViewContextProvider: FlowComponent<
  SoupViewContextProviderProps
> = (props) => {
  const soup = props.soup ?? createSoupState();

  const [searchText, setSearchText] = createSignal('');
  const [internalQueryFilters, setQueryFilters] =
    createSignal<SoupItemsQueryFilters>({});

  const trimmedSearchText = createMemo(() => searchText().trim());

  const debouncedSearchForLocal = debouncedDependent(
    trimmedSearchText,
    LOCAL_FUZZY_SEARCH_DEBOUNCE_MS
  );

  const debouncedSearchForService = debouncedDependent(
    trimmedSearchText,
    SEARCH_SERVICE_DEBOUNCE_MS
  );

  const isSearching = createMemo(() => trimmedSearchText().length > 0);

  const unifiedSearchIncludeArray = createMemo<UnifiedSearchIndex[]>(
    () => {
      const types = soup.filters.activeIds() as FilterID[];
      // NOTE: empty array means search all
      const includeArray: UnifiedSearchIndex[] = [];
      for (const type of types) {
        match(type)
          .with('document', 'file', 'task', () => {
            includeArray.push('documents');
          })
          .with('agent', () => {
            includeArray.push('chats');
          })
          .with('people', 'teams', 'channels', () => {
            includeArray.push('channels');
          })
          .with('email', () => {
            includeArray.push('emails');
          })
          .with(
            'signal',
            'noise',
            'explicit-noise',
            'unread',
            'not-done',
            () => {}
          )
          .exhaustive();
      }
      return Array.from(new Set(includeArray));
    },
    [],
    { equals: arrayEquals }
  );

  const validSearchTerms = createMemo(
    () => debouncedSearchForService().length >= 3
  );
  const isSearchDisabled = createMemo(() => !validSearchTerms());

  const queryFilters = createMemo(() => {
    const base = internalQueryFilters();

    return {
      ...base,
      ...props.queryFilters,
      // Deep merge individual filter objects if both exist
      channel_filters: {
        ...base.channel_filters,
        ...props.queryFilters?.channel_filters,
      },
      chat_filters: {
        ...base.chat_filters,
        ...props.queryFilters?.chat_filters,
      },
      document_filters: {
        ...base.document_filters,
        ...props.queryFilters?.document_filters,
      },
      email_filters: {
        ...base.email_filters,
        ...props.queryFilters?.email_filters,
      },
      project_filters: {
        ...base.project_filters,
        ...props.queryFilters?.project_filters,
      },
    };
  });

  const searchFilters = createMemo(() => {
    const {
      channel_filters,
      chat_filters,
      document_filters,
      email_filters,
      project_filters,
    } = queryFilters();

    let fileTypes = document_filters?.file_types;

    if (soup.filters.isActive('file')) {
      fileTypes = getFolderFileTypes('search');
    }

    return {
      channel:
        channel_filters?.channel_ids?.length ||
        channel_filters?.channel_types?.length
          ? channel_filters
          : null,
      chat:
        chat_filters?.chat_ids?.length || chat_filters?.project_ids?.length
          ? chat_filters
          : null,
      document:
        document_filters?.document_ids?.length ||
        document_filters?.project_ids?.length ||
        document_filters?.file_types?.length
          ? { ...document_filters, file_types: fileTypes }
          : null,
      email: email_filters?.recipients?.length ? email_filters : null,
      project: project_filters?.project_ids?.length ? project_filters : null,
    };
  });

  const searchUnifiedNameContentRequest = createMemo(
    (): UnifiedSearchRequest => {
      const terms = debouncedSearchForService();
      const include = unifiedSearchIncludeArray();
      const filters = searchFilters();

      return {
        search_on: 'name_content',
        match_type: 'partial',
        terms: terms.length > 0 ? [terms] : undefined,
        include,
        filters,
      };
    }
  );

  const itemsQuery = useSoupItemsQuery(
    () => ({
      params: {
        limit: 100,
        sort_method: soup.sort.active()[0]?.id ?? 'updated_at',
      },
      body: { ...queryFilters(), emailView: 'all' },
    }),
    () => ({
      enabled: isSearchDisabled(),
    })
  );

  const searchQuery = useSearchSoupQuery(
    () => ({
      params: {
        page_size: 100,
      },
      body: {
        ...searchUnifiedNameContentRequest(),
      },
    }),
    () => ({
      enabled: !isSearchDisabled(),
    })
  );

  // load all channels into memory for local search
  const channelItemsQuery = useSoupItemsQuery(() => CHANNEL_PRELOAD_ARGS);
  createRenderEffect(() => {
    if (
      channelItemsQuery.hasNextPage &&
      !channelItemsQuery.isFetchingNextPage
    ) {
      channelItemsQuery.fetchNextPage();
    }
  });

  const nameFuzzySearchFilter = (items: EntityData[]) => {
    const query = debouncedSearchForLocal();
    if (!query || query.length === 0) return items;

    const matchResults = fuzzyMatch(query, items, (item) => item.name);

    return matchResults.map((result) => {
      return {
        ...result.item,
        search: {
          nameHighlight: mergeAdjacentMacroEmTags(result.nameHighlight),
          contentHitData: null,
          source: 'local',
        },
      } as WithSearch<EntityData>;
    });
  };

  const notificationSource = useGlobalNotificationSource();

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

  const localFuzzyResults = createMemo(() => {
    const pool = mergeEntityPools(
      itemsQuery.data ?? [],
      channelItemsQuery.data ?? []
    );
    return nameFuzzySearchFilter(pool);
  });

  const freshSearchResults = createMemo<EntityData[]>(() => {
    if (isSearchDisabled()) return [];
    if (searchQuery.isFetching && !searchQuery.isFetchingNextPage) return [];
    return searchQuery.data ?? [];
  });

  const items = createMemo<SoupEntity[]>(
    (prev) => {
      const searching = isSearching();

      if (!searching) {
        const data = itemsQuery.data;
        if (!data) return prev;
        return data.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];
      }

      const local = localFuzzyResults();
      const service = freshSearchResults();

      const merged: SoupEntity[] = [...service, ...local];

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

  const entities = () => {
    const filters = soup.filters.active();
    let transformed = items();

    const next = [];

    for (const entity of transformed) {
      if (!filters.every((f) => f.predicate(entity))) {
        continue;
      }

      next.push(entity);
    }

    transformed = deduplicateEntities(next);

    if (isSearching()) {
      transformed.sort(sortEntitiesForSearch);
    }

    const sorts = soup.sort.active();

    if (sorts.length > 0) {
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

  const rows = createMemo(() => {
    return entities().map((e) => attachMethods(e));
  });

  const context = {
    soup,
    source: {
      data: entities,
      isLoading: () => {
        if (itemsQuery.isLoading) return true;
        if (searchQuery.isLoading && !itemsQuery.data) return true;
        return false;
      },
      isFetching: () => searchQuery.isFetching || itemsQuery.isFetching,
      isFetchingNextPage: () =>
        searchQuery.isFetchingNextPage || itemsQuery.isFetchingNextPage,
      hasNextPage: () => {
        return (
          (searchQuery.isEnabled && searchQuery.hasNextPage) ||
          (itemsQuery.isEnabled && itemsQuery.hasNextPage)
        );
      },
      fetchNextPage: () => {
        if (searchQuery.isEnabled) {
          searchQuery.fetchNextPage();
        }

        if (itemsQuery.isEnabled) {
          itemsQuery.fetchNextPage();
        }
      },
    },
    rows,
    searchText,
    setSearchText,
    isSearchDisabled,
    queryFilters,
    setQueryFilters,
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
