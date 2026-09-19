import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import { type EntityData, isChannelEntity } from '@entity/types/entity';
import type { WithSearch } from '@entity/types/search';
import {
  type SearchSoupQueryArgs,
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import { type Accessor, createMemo } from 'solid-js';
import { type SoupSearchPoolEntry, useOptionalSearchContext } from './context';
import { createSoupFreshSearch, nameFuzzySearchFilter } from './utils';

const LOCAL_SEARCH_DEBOUNCE_MS = 20;
const SERVICE_SEARCH_DEBOUNCE_MS = 300;
const FEATURED_RESULT_COUNT = 3;

export type SoupSearchMatchType = 'exact' | 'partial';

export type SoupSearchRequest = {
  query: string;
  matchType: SoupSearchMatchType;
};

export type CreateSearchStateOptions = {
  text: Accessor<string>;
  buildRequest: (search: SoupSearchRequest) => SearchSoupQueryArgs;
  enabled?: Accessor<boolean>;
  localPool?: Accessor<SoupSearchPoolEntry[]>;
  disableLocalSearch?: Accessor<boolean>;
  hideLocalResults?: Accessor<boolean>;
  searchPaused?: Accessor<boolean>;
};

export function soupSearchMatchType(query: string): SoupSearchMatchType {
  const trimmed = query.trim();
  const quoted =
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"') &&
    trimmed.indexOf('"', 1) === trimmed.length - 1;

  return quoted ? 'exact' : 'partial';
}

const freshSearch = createSoupFreshSearch();

/**
 * Combines local quick-access search with service-backed results while
 * retaining the established Soup search behavior.
 */
export function createSearchState(options: CreateSearchStateOptions) {
  const context = useOptionalSearchContext();

  const text = createMemo(() => options.text().trim());
  const localText = debouncedDependent(text, LOCAL_SEARCH_DEBOUNCE_MS);
  const serviceText = debouncedDependent(text, SERVICE_SEARCH_DEBOUNCE_MS);

  const isSearching = () => text().length > 0;
  const isServiceDebounceSettled = () => text() === serviceText();
  const isServiceDisabled = () => !validateSearchServiceText(serviceText());

  const queryEnabled = () =>
    !isServiceDisabled() &&
    isServiceDebounceSettled() &&
    !options.searchPaused?.() &&
    (options.enabled?.() ?? true);

  const searchQuery = useSearchSoupQuery(
    () =>
      options.buildRequest({
        query: serviceText(),
        matchType: soupSearchMatchType(serviceText()),
      }),
    () => ({ enabled: queryEnabled() })
  );

  const localPool = () => {
    if (options.localPool) return options.localPool();
    if (context) return context.entityPool();
    return [];
  };

  const localFuzzyPoolResults = createMemo((): WithSearch<EntityData>[] => {
    const query = localText();
    if (options.disableLocalSearch?.() || !query) return [];
    const ranked = freshSearch(localPool(), query);
    return nameFuzzySearchFilter(
      ranked.map((result) => result.item.data),
      query
    ) as WithSearch<EntityData>[];
  });

  const localFuzzyResults = createMemo(() => {
    if (options.hideLocalResults?.()) return [];

    const entities = localFuzzyPoolResults();
    const channels = entities.filter((entity) => isChannelEntity(entity));

    const nonChannels = entities
      .filter((entity) => !isChannelEntity(entity))
      .slice(0, FEATURED_RESULT_COUNT);

    return [...channels, ...nonChannels];
  });

  const serviceSearchResults = createMemo<EntityData[]>(() => {
    if (isServiceDisabled() || !isServiceDebounceSettled()) return [];

    if (searchQuery.isFetching && !searchQuery.isFetchingNextPage) return [];

    return searchQuery.data ?? [];
  });

  const featuredIds = createMemo<string[]>(
    () => localFuzzyResults().map((entity) => entity.id),
    [],
    { equals: arrayEquals }
  );

  const data = createMemo<EntityData[]>((previous) => {
    if (!isSearching()) return [];

    const local = localFuzzyResults();
    const service = serviceSearchResults();
    const merged = [...service, ...local];

    if (merged.length === 0 && previous.length > 0 && text() !== localText()) {
      return previous;
    }

    const byId = new Map<string, EntityData>();

    for (const entity of merged) {
      if (!byId.has(entity.id)) byId.set(entity.id, entity);
    }

    const featured = new Set(featuredIds());

    return [
      ...featuredIds().flatMap((id) => {
        const entity = byId.get(id);
        return entity ? [entity] : [];
      }),
      ...[...byId.values()].filter((entity) => !featured.has(entity.id)),
    ];
  }, []);

  const isLocalSearchSettling = () => isSearching() && text() !== localText();

  const isSearchServiceLoading = () => {
    if (!isSearching() || !validateSearchServiceText(text())) return false;

    if (!(options.enabled?.() ?? true) || options.searchPaused?.())
      return false;

    if (!isServiceDebounceSettled()) return true;

    return searchQuery.isFetching && !searchQuery.isFetchingNextPage;
  };

  return {
    data,
    isSearching,
    localFuzzyResults,
    serviceSearchResults,
    featuredIds,
    searchQuery,
    isSearchServiceLoading,
    isLocalSearchSettling,
    isSettling: () => isLocalSearchSettling() || isSearchServiceLoading(),
    usesServiceSearch: queryEnabled,
    isLoading: () => isSearchServiceLoading() && data().length === 0,
    isFetching: () => isSearchServiceLoading() || searchQuery.isFetching,
    error: () =>
      searchQuery.error instanceof Error ? searchQuery.error : undefined,
    hasNextPage: () => queryEnabled() && (searchQuery.hasNextPage ?? false),
    isFetchingNextPage: () => searchQuery.isFetchingNextPage,
    fetchNextPage: () => searchQuery.fetchNextPage(),
    refetch: () => searchQuery.refetch(),
    /** Refetches the service results, throwing on failure so a caller (mobile
     * pull-to-refresh) can report the outcome. Resolves without a request
     * when the service query is disabled — a short or paused query renders
     * local fuzzy matches, which have no network source to refetch. */
    refresh: async () => {
      if (!searchQuery.isEnabled) return;
      await searchQuery.refetch({ throwOnError: true });
    },
  };
}

export type SearchState = ReturnType<typeof createSearchState>;
