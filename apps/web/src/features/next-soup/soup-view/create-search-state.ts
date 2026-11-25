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
  /** The text the search service is sent, when it differs from the field's. */
  serviceText?: Accessor<string>;
  /** The words names are matched with, when they differ from the field's. */
  nameText?: Accessor<string>;
  /**
   * The types a query's operators leave to search, which name matches are
   * narrowed to, or undefined for every type.
   */
  operatorIndexes?: Accessor<readonly string[] | undefined>;
}

const namesAny = (ids: readonly string[] | undefined) =>
  ids?.some((id) => id !== NIL_UUID) ?? false;

/**
 * Local results match by name against the view's predicates only, so they are
 * hidden where a filter has no predicate to test them with: a named channel or
 * sender (those searches list message hits, not channel rows) and, in the
 * Search view, its task facets. A type filter NIL-excludes every other type,
 * which names nothing.
 */
export function hidesLocalSearchResults(
  include: QueryState['include'],
  surface: string
) {
  if (namesAny(include.channelId) || namesAny(include.channelSenderId))
    return true;
  return (
    surface === 'search' &&
    (namesAny(include.documentOwnerId) || (include.properties?.length ?? 0) > 0)
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
  serviceText,
  nameText,
  operatorIndexes,
}: CreateSearchStateArgs) => {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const getFilterContext = (): FilterContext => ({
    userId: userId(),
    notificationSource,
    assignees: assignees(),
  });

  const hideLocalResults = () =>
    hidesLocalSearchResults(filters().include, surface());
  const searchContext = useSearchContext();
  const namesText = nameText ?? searchText;
  const entityPool = searchContext.entityPool(
    () =>
      !disableLocalSearch?.() &&
      !hideLocalResults() &&
      Boolean(namesText().trim())
  );
  const localPool = createLazyMemo(() => {
    const pool =
      surface() === 'search'
        ? [...entityPool(), ...searchContext.routinePool()]
        : entityPool();
    const activeIds = soup.predicates
      .activeIds()
      .filter((id) => id !== 'explicit-noise');
    const indexes = operatorIndexes?.();
    if (activeIds.length === 0 && !indexes) return pool;

    const context = getFilterContext();
    const entities = pool.map((item) => item.data);
    const matching = (id: string) => {
      const predicate = soup.predicates.available.find(
        (candidate) => candidate.id === id
      );
      if (!predicate) return [];
      return entities.filter((entity) => predicate.predicate(entity, context));
    };
    const pools = activeIds.map(matching);
    // The types `type:` names are alternatives: a match is any one of them.
    if (indexes) pools.push(indexes.flatMap(matching));
    const matches = intersectEntityPools(pools);
    const matchingIds = new Set(matches.map((entity) => entity.id));
    return pool.filter((item) => matchingIds.has(item.data.id));
  });

  const search = createSharedSearchState({
    surface,
    text: serviceText ?? searchText,
    nameText: namesText,
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
    localSearchText: search.localSearchText,
    refresh: search.refresh,
    isSearching: search.isSearching,
    serviceSearchResults: search.serviceSearchResults,
    featuredIds: search.featuredIds,
    searchQuery: search.searchQuery,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
  };
};
