import type { SoupState } from '@app/component/next-soup/create-soup-state';
import { useSearchContext } from '@app/component/next-soup/search-context';
import {
  createSoupFreshSearch,
  getValidSearchFilters,
  intersectEntityPools,
  nameFuzzySearchFilter,
} from '@app/component/next-soup/search-utils';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import { isChannelEntity, type EntityData } from '@entity';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import {
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import type { UnifiedSearchRequest } from '@service-search/generated/models';
import { type Accessor, createMemo, createSignal, on } from 'solid-js';

const SEARCH_SERVICE_DEBOUNCE_MS = 300;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;
// Max number of non-channel local results to feature. Channels bypass this
// limit since they are only searched locally, not via the backend search service.
const FEATURED_COUNT = 3;

const freshSearch = createSoupFreshSearch();

interface CreateSearchStateArgs {
  soup: SoupState;
  queryFilters: Accessor<SoupItemsQueryFilters>;
  disableLocalSearch?: boolean;
  searchPaused?: Accessor<boolean>;
  searchMentions?: Accessor<string[]>;
}

export const createSearchState = ({
  soup,
  queryFilters,
  disableLocalSearch,
  searchPaused,
  searchMentions,
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

  const isSearchServiceDisabled = createMemo(
    () => !validateSearchServiceText(debouncedSearchForService())
  );

  const searchUnifiedNameContentRequest = createMemo(
    (): UnifiedSearchRequest => {
      const filters = queryFilters();
      const query = debouncedSearchForService();
      const mentionIds =
        isSearchServiceDebounceSettled() && !isSearchServiceDisabled()
          ? searchMentions?.()
          : undefined;
      return {
        search_on: 'name_content',
        match_type: 'partial',
        query,
        filters:
          mentionIds && mentionIds.length > 0
            ? {
                ...filters,
                channel_filters: {
                  ...filters.channel_filters,
                  mentions: mentionIds,
                },
              }
            : filters,
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
      enabled:
        !isSearchServiceDisabled() &&
        isSearchServiceDebounceSettled() &&
        !searchPaused?.(),
    })
  );

  const { entityPool } = useSearchContext();

  const localFuzzyResults = createMemo(
    on(debouncedSearchForLocal, (query) => {
      if (disableLocalSearch) return [];
      if (!query || query.length === 0) return [];
      const pool = entityPool();
      // TODO: we can optimize fresh search for small feature counts since we
      // don't need to sort everything, we just need the featured results
      const freshSearchResults = freshSearch(pool, query);
      // NOTE: this is a temporary hack because the fresh search fuzzy library
      // does not give us the highlighted matches
      const results = nameFuzzySearchFilter(
        freshSearchResults.map((r) => r.item.data),
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

  // we will hide local results if there are channel filters because we only want message results
  const hasChannelQueryFilters = () => {
    const cf = queryFilters().channel_filters;
    return !!(cf?.channel_ids?.length || cf?.sender_ids?.length);
  };

  const filteredLocalFuzzyResults = createMemo(() => {
    if (!localFuzzyResults()) return [];
    if (hasChannelQueryFilters()) return [];
    const activeFilters = getValidSearchFilters(soup.filters.active());
    const results =
      activeFilters.length === 0
        ? localFuzzyResults()
        : intersectEntityPools(
            activeFilters.map((f) => allFiltersResults().get(f.id) ?? [])
          );
    const channels = results.filter((e) => isChannelEntity(e));
    const nonChannels = results
      .filter((e) => !isChannelEntity(e))
      .slice(0, FEATURED_COUNT);
    return [...channels, ...nonChannels];
  });

  const serviceSearchResults = createMemo<EntityData[]>(() => {
    if (isSearchServiceDisabled()) return [];
    if (!isSearchServiceDebounceSettled()) return [];
    if (searchQuery.isFetching && !searchQuery.isFetchingNextPage) return [];
    return searchQuery.data ?? [];
  });

  const featuredIds = createMemo<string[]>(
    () => filteredLocalFuzzyResults().map((r) => r.id),
    [],
    { equals: arrayEquals }
  );

  const isLocalSearchSettling = createMemo(
    () => isSearching() && trimmedSearchText() !== debouncedSearchForLocal()
  );

  const isSearchServiceLoading = createMemo(() => {
    if (!isSearching()) return false;
    if (!validateSearchServiceText(trimmedSearchText())) return false;
    if (!isSearchServiceDebounceSettled()) return true;
    if (searchQuery.isFetching && !searchQuery.isFetchingNextPage) return true;
    return false;
  });

  return {
    searchText,
    setSearchText,
    isSearching,
    localFuzzyResults: filteredLocalFuzzyResults,
    serviceSearchResults,
    featuredIds,
    searchQuery,
    isSearchServiceLoading,
    isLocalSearchSettling,
  };
};

export type SearchState = ReturnType<typeof createSearchState>;
