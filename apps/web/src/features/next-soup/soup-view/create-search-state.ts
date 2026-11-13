import type { SoupState } from '@app/features/next-soup/create-soup-state';
import type { FilterContext } from '@app/features/next-soup/filters/configs/base';
import {
  NIL_UUID,
  type QueryState,
} from '@app/features/next-soup/filters/filter-store';
import {
  createSearchState as createSharedSearchState,
  intersectEntityPools,
  useSearchContext,
} from '@app/features/soup/search';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor, Setter } from 'solid-js';
import { buildSoupSearchRequest } from '../queries/search-request';

interface CreateSearchStateArgs {
  /** Where the search runs, for analytics. */
  surface: Accessor<string>;
  soup: SoupState;
  filters: Accessor<QueryState>;
  assignees: Accessor<string[]>;
  disableLocalSearch?: Accessor<boolean>;
  searchPaused?: Accessor<boolean>;
  /**
   * Reactive search text. Owned by the caller so it can be wired to
   * per-entry navigation state and survive back/forward.
   */
  searchText: Accessor<string>;
  setSearchText: Setter<string>;
}

const namesAny = (ids: readonly string[] | undefined) =>
  ids?.some((id) => id !== NIL_UUID) ?? false;

/**
 * Local results match by name against predicates only, so they are hidden for
 * the filters they cannot be tested against: a named channel or sender (those
 * searches list message hits, not channel rows) and task facets. A type filter
 * NIL-excludes every other type, which names nothing.
 */
export function hidesLocalSearchResults(include: QueryState['include']) {
  return (
    namesAny(include.channelId) ||
    namesAny(include.channelSenderId) ||
    namesAny(include.documentOwnerId) ||
    (include.properties?.length ?? 0) > 0
  );
}

export const createSearchState = ({
  surface,
  soup,
  filters,
  assignees,
  disableLocalSearch,
  searchPaused,
  searchText,
  setSearchText,
}: CreateSearchStateArgs) => {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const getFilterContext = (): FilterContext => ({
    userId: userId(),
    notificationSource,
    assignees: assignees(),
  });

  const { entityPool, routinePool } = useSearchContext();
  const localPool = createLazyMemo(() => {
    const pool =
      surface() === 'search'
        ? [...entityPool(), ...routinePool()]
        : entityPool();
    const activeIds = soup.predicates
      .activeIds()
      .filter((id) => id !== 'explicit-noise');
    if (activeIds.length === 0) return pool;

    const context = getFilterContext();
    const entities = pool.map((item) => item.data);
    const matches = intersectEntityPools(
      activeIds.map((id) => {
        const predicate = soup.predicates.available.find(
          (candidate) => candidate.id === id
        );
        if (!predicate) return [];
        return entities.filter((entity) =>
          predicate.predicate(entity, context)
        );
      })
    );
    const matchingIds = new Set(matches.map((entity) => entity.id));
    return pool.filter((item) => matchingIds.has(item.data.id));
  });

  const hideLocalResults = () => hidesLocalSearchResults(filters().include);

  const search = createSharedSearchState({
    surface,
    text: searchText,
    buildRequest: (search) => buildSoupSearchRequest(filters(), search),
    localPool,
    disableLocalSearch,
    hideLocalResults,
    searchPaused,
  });

  return {
    searchText,
    setSearchText,
    localFuzzyResults: search.localFuzzyResults,
    refresh: search.refresh,
    isSearching: search.isSearching,
    serviceSearchResults: search.serviceSearchResults,
    featuredIds: search.featuredIds,
    searchQuery: search.searchQuery,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
  };
};
