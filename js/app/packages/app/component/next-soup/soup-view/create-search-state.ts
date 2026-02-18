import type { SoupState } from '@app/component/next-soup/create-soup-state';
import {
  type FilterID,
  getFileAssociations,
} from '@app/component/next-soup/filters/filters';
import { useSearchContext } from '@app/component/next-soup/search-context';
import {
  createSoupFreshSearch,
  getValidSearchFilters,
  intersectEntityPools,
  nameFuzzySearchFilter,
} from '@app/component/next-soup/search-utils';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import type { EntityData } from '@entity';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import { useSearchSoupQuery } from '@queries/soup/search';
import type {
  UnifiedSearchIndex,
  UnifiedSearchRequest,
} from '@service-search/generated/models';
import { type Accessor, createMemo, createSignal, on } from 'solid-js';
import { match } from 'ts-pattern';

const SEARCH_SERVICE_DEBOUNCE_MS = 300;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;
const FEATURED_COUNT = 3;

const freshSearch = createSoupFreshSearch();

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

  const { entityPool } = useSearchContext();

  const localFuzzyResults = createMemo(
    on(debouncedSearchForLocal, (query) => {
      if (!query || query.length === 0) return [];
      const pool = entityPool();
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
