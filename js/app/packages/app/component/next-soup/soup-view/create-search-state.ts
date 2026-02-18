import type { SoupState } from '@app/component/next-soup/create-soup-state';
import {
  type FilterID,
  getFileAssociations,
  EXCLUDE,
} from '@app/component/next-soup/filters/filters';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent, throttledDependent } from '@core/util/debounce';
import { fuzzyMatch } from '@core/util/fuzzy';
import { mergeAdjacentMacroEmTags } from '@core/util/searchHighlight';
import { createFreshSearch } from '@core/util/freshSort';
import type { EntityData, WithSearch } from '@entity';
import { isChannelEntity } from '@entity';
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
  createMemo,
  createSignal,
  on,
  createDeferred,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { FilterConfig } from '../filters';
import type { SoupEntity } from './soup-view-context';
import { throttle } from '@solid-primitives/scheduled';

const SEARCH_SERVICE_DEBOUNCE_MS = 300;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;
const FEATURED_COUNT = 3;

const CHANNEL_PRELOAD_ARGS: SoupItemsQueryArgs = {
  params: { limit: 500, sort_method: 'updated_at' },
  body: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: { channel_ids: [] },
  },
};

const ITEM_PRELOAD_ARGS: SoupItemsQueryArgs = {
  params: { limit: 500, sort_method: 'updated_at' },
  body: {
    chat_filters: { chat_ids: [] },
    document_filters: { document_ids: [] },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: [] },
    channel_filters: { channel_ids: EXCLUDE },
  },
};

// we drop explicit noise because it's essentially an identity filter for search results
const getValidSearchFilters = (
  filters: readonly FilterConfig<SoupEntity>[]
) => {
  return filters.filter((f) => f.id !== 'explicit-noise');
};

/** adds name highlight to item list based on fuzzy match */
const nameFuzzySearchFilter = (
  items: EntityData[],
  query: string
): EntityData[] | WithSearch<EntityData>[] => {
  if (!query || query.length === 0) return items;

  const matchResults = fuzzyMatch(query, items, (item) => item.name, {
    noSort: true,
  });

  //  we need to return the original items in the same order
  const resultMap = new Map(
    matchResults.map((r) => [
      r.item.id,
      { nameHighlight: r.nameHighlight, score: r.score },
    ])
  );
  return items
    .filter((item) => resultMap.has(item.id))
    .map((item) => {
      const matchResult = resultMap.get(item.id)!;
      return {
        ...item,
        search: {
          nameHighlight: mergeAdjacentMacroEmTags(matchResult.nameHighlight),
          contentHitData: null,
          source: 'local',
        },
      } as WithSearch<EntityData>;
    });
};

const freshSearch = createFreshSearch<EntityData>(
  {
    useViewedAt: true,
    channelBoost: 3,
    fuzzyWeight: 0.7,
    timeWeight: 0.3,
    minFuzzyThreshold: 0.1,
    commaSeparatedChannelMatch: true,
  },
  (item) => item.name,
  (item) => isChannelEntity(item),
  (item) => item
);

/** Takes a list of entity pools and returns a list of unique entities that are present in all pools, deduplicating by id */
function intersectEntityPools(pools: readonly EntityData[][]): EntityData[] {
  if (pools.length === 0) return [];
  if (pools.length === 1) return pools[0];

  const idCounts = new Map<string, number>();
  const entityById = new Map<string, EntityData>();

  for (const pool of pools) {
    const seen = new Set<string>();
    for (const entity of pool) {
      if (!seen.has(entity.id)) {
        seen.add(entity.id);
        idCounts.set(entity.id, (idCounts.get(entity.id) ?? 0) + 1);
        if (!entityById.has(entity.id)) {
          entityById.set(entity.id, entity);
        }
      }
    }
  }

  const result: EntityData[] = [];
  for (const [id, count] of idCounts) {
    if (count === pools.length) {
      result.push(entityById.get(id)!);
    }
  }

  return result;
}

interface CreateSearchStateArgs {
  soup: SoupState;
  queryFilters: Accessor<SoupItemsQueryFilters>;
}

export const createSearchState = ({
  soup,
  queryFilters,
}: CreateSearchStateArgs) => {
  const [searchText, setSearchText] = createSignal('');

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

  const isSearchServiceDebounceSettled = createMemo(
    () => trimmedSearchText() === debouncedSearchForService()
  );

  const unifiedSearchIncludeArray = createMemo<UnifiedSearchIndex[]>(
    () => {
      const types = soup.filters.activeIds() as FilterID[];
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
          .otherwise(() => {});
      }
      return Array.from(new Set(includeArray));
    },
    [],
    { equals: arrayEquals }
  );

  const validSearchTerms = createMemo(
    () => debouncedSearchForService().length >= 3
  );
  const isSearchServiceDisabled = createMemo(() => !validSearchTerms());

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
      fileTypes = getFileAssociations('search');
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
      enabled: !isSearchServiceDisabled() && isSearchServiceDebounceSettled(),
    })
  );

  // NOTE: this is effectively the same as useHistory but with soup
  const itemsQuery = useSoupItemsQuery(() => ITEM_PRELOAD_ARGS);
  const itemsFetchNextPage = throttle(() => itemsQuery.fetchNextPage(), 2000);
  createDeferred(() => {
    if (itemsQuery.hasNextPage && !itemsQuery.isFetchingNextPage) {
      itemsFetchNextPage();
    }
  });

  const channelItemsQuery = useSoupItemsQuery(() => CHANNEL_PRELOAD_ARGS);
  const channelItemsFetchNextPage = throttle(
    () => channelItemsQuery.fetchNextPage(),
    2000
  );
  createDeferred(() => {
    if (
      channelItemsQuery.hasNextPage &&
      !channelItemsQuery.isFetchingNextPage
    ) {
      channelItemsFetchNextPage();
    }
  });

  const [localFuzzyEntityPool, setLocalFuzzyEntityPool] = createSignal<
    EntityData[]
  >([]);
  // NOTE: this will load the local fuzzy results in the background
  // we use the throttled signals to avoid calculating too often
  const itemsQueryData = throttledDependent(() => itemsQuery.data ?? [], 5000);
  const channelItemsQueryData = throttledDependent(
    () => channelItemsQuery.data ?? [],
    5000
  );
  createDeferred(() => {
    setLocalFuzzyEntityPool([...itemsQueryData(), ...channelItemsQueryData()]);
  });

  const localFuzzyResults = createMemo(
    on(debouncedSearchForLocal, (query) => {
      if (!query || query.length === 0) return [];
      const pool = localFuzzyEntityPool();
      // TODO: we can optimize fresh search for small feature counts since we
      // don't need to sort everything, we just need the featured results
      const freshSearchResults = freshSearch(pool, query);
      // NOTE: this is a temporary hack because the fresh search fuzzy library
      // does not give us the highlighted matches
      const results = nameFuzzySearchFilter(
        freshSearchResults.map((r) => r.item),
        query
      );
      return results;
    })
  );

  const allFiltersResults = createMemo((): Map<string, EntityData[]> => {
    if (!localFuzzyResults()) return new Map();
    const allFilters = getValidSearchFilters(soup.filters.available);
    const filterToResultMap = new Map<string, EntityData[]>();
    for (const filter of allFilters) {
      filterToResultMap.set(
        filter.id,
        localFuzzyResults().filter((e) => filter.predicate(e))
      );
    }
    return filterToResultMap;
  });

  const filteredLocalFuzzyResults = createMemo(() => {
    if (!localFuzzyResults()) return [];
    const activeFilters = getValidSearchFilters(soup.filters.active());
    if (activeFilters.length === 0)
      return localFuzzyResults().slice(0, FEATURED_COUNT);
    const pools = activeFilters.map((f) => allFiltersResults().get(f.id) ?? []);
    const merged = intersectEntityPools(pools);
    return merged.slice(0, FEATURED_COUNT);
  });

  const serviceSearchResults = createMemo<EntityData[]>(() => {
    if (isSearchServiceDisabled()) return [];
    if (!isSearchServiceDebounceSettled()) return [];
    if (searchQuery.isFetching && !searchQuery.isFetchingNextPage) return [];
    return searchQuery.data ?? [];
  });

  const featuredIds = createMemo(() => {
    const ids = filteredLocalFuzzyResults().map((r) => r.id);
    return ids;
  });

  return {
    searchText,
    setSearchText,
    isSearching,
    localFuzzyResults: filteredLocalFuzzyResults,
    serviceSearchResults,
    featuredIds,
    searchQuery,
  };
};

export type SearchState = ReturnType<typeof createSearchState>;
