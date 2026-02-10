import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  createSoupState,
  type SoupState,
} from '@app/component/next-soup/create-soup-state';
import {
  buildDssFiltersRequest,
  getFolderFileTypes,
} from '@app/component/next-soup/filters/filters';
import { sortEntitiesForSearch } from '@app/component/next-soup/soup-view/sort-options';
import { deduplicateEntities } from '@app/component/next-soup/utils';
import { useEmailLinksStatus } from '@core/email-link';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyMatch } from '@core/util/fuzzy';
import type { EntityData, WithNotification, WithSearch } from '@entity';
import { useNotificationsForEntity } from '@notifications';
import {
  type SoupItemsQueryFilters,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { useSearchSoupQuery } from '@queries/soup/search';
import type { SearchArgs } from '@service-search/client';
import type { UnifiedSearchIndex } from '@service-search/generated/models';
import {
  type Accessor,
  createContext,
  createMemo,
  createRenderEffect,
  createSignal,
  type FlowComponent,
  on,
  Suspense,
  useContext,
} from 'solid-js';
import { match } from 'ts-pattern';

const SEARCH_SERVICE_DEBOUNCE_MS = 300;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;

type Row<T> = {
  original: T;
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

  const emailActive = useEmailLinksStatus();

  const [searchText, setSearchText] = createSignal('');

  const debouncedSearchForLocal = debouncedDependent(
    searchText,
    LOCAL_FUZZY_SEARCH_DEBOUNCE_MS
  );

  const debouncedSearchForService = debouncedDependent(
    searchText,
    SEARCH_SERVICE_DEBOUNCE_MS
  );

  const unifiedSearchIncludeArray = createMemo<UnifiedSearchIndex[]>(
    () => {
      let types = soup.filters.activeIds();
      // NOTE: empty array means search all
      if (types.length === 0) types = [];
      const includeArray: UnifiedSearchIndex[] = [];
      for (const type of types) {
        match(type)
          .with('document', () => {
            includeArray.push('documents');
          })
          .with('agent', () => {
            includeArray.push('chats');
          })
          .with('people', 'teams', () => {
            includeArray.push('channels');
          })
          .with('email', () => {
            includeArray.push('emails');
          })
          .with('project', () => {
            includeArray.push('projects');
          });
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

  const searchUnifiedNameContentQueryParams = createMemo(
    (prev: SearchArgs | undefined): SearchArgs => {
      if (prev && prev.request.terms?.[0] === debouncedSearchForService()) {
        return prev;
      }

      return {
        params: {
          cursor: null,
          page_size: 100,
        },
        request: {
          search_on: 'name_content',
          match_type: 'partial',
          terms:
            debouncedSearchForService().length > 0
              ? [debouncedSearchForService()]
              : undefined,
          // filters: unifiedSearchFilters(),
          include: unifiedSearchIncludeArray(),
        },
      };
    }
  );

  const queryFilters = createMemo(() => {
    const base = buildDssFiltersRequest(soup.filters.active(), {
      extra: props.queryFilters,
      isSearchActive: !isSearchDisabled(),
      emailActive: emailActive(),
    });

    if (soup.filters.isActive('file')) {
      if (base.document_filters?.file_types) {
        base.document_filters.file_types = getFolderFileTypes('soup');
      }
    }

    if (soup.filters.isActive('task')) {
      if (base.document_filters?.file_types) {
        base.document_filters.file_types = ['md'];
      }
    }

    return base;
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
      channel: channel_filters?.channel_ids?.length ? channel_filters : null,
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

  const itemsQuery = useSoupItemsQuery(
    () => ({
      params: {
        limit: 100,
        sort_method: soup.sort.active()[0]?.id ?? 'updated_at',
      },
      body: queryFilters(),
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
        ...searchFilters(),
        ...searchUnifiedNameContentQueryParams().request,
      },
    }),
    () => ({
      enabled: !isSearchDisabled(),
    })
  );

  const nameFuzzySearchFilter = (items: EntityData[]) => {
    const query = debouncedSearchForLocal();
    if (!query || query.length === 0) return items;

    const matchResults = fuzzyMatch(query, items, (item) => item.name);

    return matchResults.map((result) => {
      return {
        ...result.item,
        search: {
          nameHighlight: result.nameHighlight,
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

  const entities = () => {
    const itemsData = itemsQuery.data;
    const searchData = searchQuery.data;

    if (!itemsData && !searchData) return [];

    const filters = soup.filters.active();

    const isSearching = searchText().length > 0;

    const items = itemsData ?? [];
    const searchItems = isSearching ? (searchData ?? []) : [];

    let transformed: SoupEntity[] = [...searchItems];

    if (isSearching) {
      transformed.push(...nameFuzzySearchFilter(items));
    } else {
      transformed.push(...items);
    }

    transformed = transformed.map(attachNotifications);

    for (const filter of filters) {
      transformed = transformed.filter(filter.predicate);
    }

    transformed = deduplicateEntities(transformed);

    if (isSearching) {
      transformed = transformed.toSorted(sortEntitiesForSearch);
    }

    const sorts = soup.sort.active();

    if (sorts.length > 0) {
      transformed = transformed.toSorted((a, b) => {
        for (const sort of sorts) {
          const result = sort.fn(a, b);
          if (result !== 0) return result;
        }
        return 0;
      });
    }

    return transformed;
  };

  const rows = () => {
    return entities().map((e) => attachMethods(e));
  };

  const context = {
    soup,
    source: {
      data: entities,
      isLoading: () => searchQuery.isLoading || itemsQuery.isLoading,
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
