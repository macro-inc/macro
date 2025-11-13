import Fragment from '@core/util/Fragment';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { debounce } from '@solid-primitives/scheduled';
import { StaticMarkdownContext } from 'core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  type Accessor,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  type Setter,
  Switch,
  untrack,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { LIST_WRAPPER } from '../constants/classStrings';
import type {
  EntityInfiniteQuery,
  EntityList,
  EntityQuery,
  EntityQueryOperations,
  EntityQueryWithOperations,
} from '../queries/entity';
import {
  type EntitiesFilter,
  type EntityComparator,
  type EntityData,
  type EntityFilter,
  type EntityMapper,
  type EntityRenderer,
  getEntityProjectId,
} from '../types/entity';
import type { WithSearch } from '../types/search';
import { Entity } from './Entity';

const isSearchEntity = (entity: EntityData): entity is WithSearch<EntityData> =>
  'search' in entity;

/**
 * Merges search data from two entities, preferring service source with local as fallback.
 * - Uses service entity as base
 * - Falls back to local nameHighlight if service doesn't have one
 * - Falls back to local contentHighlights if service doesn't have any
 */
const mergeSearchEntities = <T extends EntityData>(
  first: T & WithSearch<EntityData>,
  second: T & WithSearch<EntityData>
): T => {
  const serviceEntity =
    first.search.source === 'service' ? first : second;
  const localEntity =
    first.search.source === 'local' ? first : second;

  return {
    ...serviceEntity,
    search: {
      ...serviceEntity.search,
      nameHighlight:
        serviceEntity.search.nameHighlight || localEntity.search.nameHighlight,
      contentHighlights:
        serviceEntity.search.contentHighlights?.length
          ? serviceEntity.search.contentHighlights
          : localEntity.search.contentHighlights,
    },
  } as T;
};

/**
 * Gets the timestamp of an entity (updatedAt or createdAt)
 */
const getEntityTimestamp = (entity: EntityData): number => {
  return entity.updatedAt ?? entity.createdAt ?? 0;
};

/**
 * Returns true if the new entity should replace the existing one based on timestamp
 */
const isNewerEntity = (
  newEntity: EntityData,
  existing: EntityData
): boolean => {
  return getEntityTimestamp(newEntity) > getEntityTimestamp(existing);
};

/**
 * Deduplicates entities by id, preferring entities with search data from 'service' source
 * over 'local' source, and using latest timestamp as a tiebreaker.
 * When preferring service results, merges local nameHighlight if service doesn't have one.
 */
const deduplicateEntities = <T extends EntityData>(entities: T[]): T[] => {
  const entityMap = new Map<string, T>();

  for (const entity of entities) {
    const existing = entityMap.get(entity.id);

    if (!existing) {
      entityMap.set(entity.id, entity);
      continue;
    }

    const existingHasSearch = isSearchEntity(existing);
    const newHasSearch = isSearchEntity(entity);

    // Prefer entities with search data
    if (newHasSearch && !existingHasSearch) {
      entityMap.set(entity.id, entity);
      continue;
    }

    // If both have search data, prefer 'service' over 'local'
    if (existingHasSearch && newHasSearch) {
      const existingSource = existing.search.source;
      const newSource = entity.search.source;

      if (
        (newSource === 'service' && existingSource === 'local') ||
        (existingSource === 'service' && newSource === 'local')
      ) {
        // Merge service and local search data
        entityMap.set(entity.id, mergeSearchEntities(entity, existing));
        continue;
      }

      // If both are the same source, keep the one with latest timestamp
      if (isNewerEntity(entity, existing)) {
        entityMap.set(entity.id, entity);
      }
      continue;
    }

    // If neither has search, keep the one with latest timestamp
    if (!existingHasSearch && !newHasSearch) {
      if (isNewerEntity(entity, existing)) {
        entityMap.set(entity.id, entity);
      }
    }
    // Otherwise keep existing (it has search and new doesn't)
  }

  return Array.from(entityMap.values());
};

/**
 * Calculates match quality score for local search results.
 * Higher score = better match.
 * Prioritizes: exact match > starts with > word boundary > fuzzy match
 */
const getLocalMatchScore = (
  entityName: string,
  nameHighlight: string | null
): number => {
  if (!nameHighlight) return 0;

  const name = entityName.toLowerCase();

  // Extract the search query from the highlighted text
  // The highlighted portion is wrapped in <macro_em>...</macro_em>
  const highlightedText = nameHighlight
    .replace(/<\/?macro_em>/g, '')
    .toLowerCase();

  // Count number of highlight segments (fewer segments = more contiguous match)
  const highlightSegments = (nameHighlight.match(/<macro_em>/g) || []).length;

  // Exact match (highest priority)
  if (name === highlightedText) return 1000;

  // Starts with match
  if (name.startsWith(highlightedText)) return 900;

  // Single contiguous match (not scattered)
  if (highlightSegments === 1) {
    // Word boundary match (after space, comma, etc.)
    if (
      name.match(
        new RegExp(
          `[\\s,+]${highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
        )
      )
    ) {
      return 800;
    }
    return 700; // Contiguous substring
  }

  // Multiple segments (fuzzy/scattered match) - penalize based on number of segments
  return Math.max(100, 500 - highlightSegments * 50);
};

/**
 * Sorts entities for search mode:
 * 1. Channels first
 * 2. Local search results before service results
 * 3. Within local results, better name matches come first
 */
const sortEntitiesForSearch = <T extends EntityData>(a: T, b: T): number => {
  const aHasSearch = isSearchEntity(a);
  const bHasSearch = isSearchEntity(b);

  if (aHasSearch && bHasSearch) {
    // Channel results come before other results
    const aIsChannel = a.type === 'channel';
    const bIsChannel = b.type === 'channel';

    if (aIsChannel && !bIsChannel) return -1;
    if (!aIsChannel && bIsChannel) return 1;

    // Local results come before service results
    const aSource = a.search.source;
    const bSource = b.search.source;

    if (aSource === 'local' && bSource === 'service') return -1;
    if (aSource === 'service' && bSource === 'local') return 1;

    // Within local results, sort by match quality
    if (
      aSource === 'local' &&
      bSource === 'local' &&
      aIsChannel &&
      bIsChannel
    ) {
      const aScore = getLocalMatchScore(a.name, a.search.nameHighlight);
      const bScore = getLocalMatchScore(b.name, b.search.nameHighlight);

      if (aScore !== bScore) {
        return bScore - aScore; // Higher score first
      }

      // If same score, prefer shorter names (more focused match)
      return a.name.length - b.name.length;
    }
  }

  return 0;
};

const DEBOUNCE_FETCH_MORE_MS = 50;

// note that this must be greater than DEBOUNCE_FETCH_MORE_MS
const DEBOUNCE_LOADING_STATE_MS = 100;

const getGroupKey = (operations?: EntityQueryOperations): PropertyKey => {
  if (!operations) return 0;
  let key = 0;
  // we don't need to group by sort because we will do a global sort at the end
  // this gives us bitwise unique keys for each pairwise combination
  if (operations.filter) key |= 1;
  if (operations.search) key |= 2;
  return key;
};

const getOperations = <T extends Partial<EntityQueryOperations>>(
  query?: T
): EntityQueryOperations => {
  if (!query) return { filter: false, search: false };
  return {
    filter: !!query.filter,
    search: !!query.search,
  };
};

interface UnifiedInfiniteListContext<T extends EntityData> {
  showProjects: Accessor<boolean>;
  entityInfiniteQueries: Array<
    EntityQueryWithOperations<
      EntityData | WithSearch<EntityData>,
      EntityInfiniteQuery
    >
  >;
  entityQueries?: Array<EntityQueryWithOperations<EntityData, EntityQuery>>;
  entityMapper?: EntityMapper<T>;
  requiredFilter?: Accessor<EntityFilter<T>>;
  optionalFilter?: Accessor<EntityFilter<T>>;
  entitySort?: Accessor<EntityComparator<T>>;
  projectFilter?: Accessor<string | undefined>;
  searchFilter?: Accessor<EntitiesFilter<T> | undefined>;
  isSearchActive?: Accessor<boolean>;
  // TODO: deduplicate entities for same match
  deduplicate?: Accessor<(prev: T, next: T) => boolean>;
}

export function createUnifiedInfiniteList<T extends EntityData>({
  entityInfiniteQueries,
  entityQueries,
  entityMapper = (entity: EntityData) => entity as T,
  requiredFilter,
  optionalFilter,
  entitySort,
  showProjects,
  projectFilter,
  searchFilter,
  isSearchActive,
}: UnifiedInfiniteListContext<T>) {
  const [sortedEntitiesStore, setSortedEntitiesStore] = createStore<T[]>([]);
  const allEntities = createMemo(() => {
    const entities =
      entityQueries?.map((query) => {
        const operations = getOperations(query.operations);
        const data =
          query.query.isSuccess && query.query.isEnabled
            ? query.query.data
            : [];
        return {
          data,
          operations,
        };
      }) ?? [];
    const groups = Object.groupBy(entities, (entityList) =>
      getGroupKey(entityList.operations)
    );

    const infiniteEntities = entityInfiniteQueries.map((query) => {
      const operations = getOperations(query.operations);
      const data =
        query.query.isSuccess && query.query.isEnabled ? query.query.data : [];
      return {
        data,
        operations,
      };
    });
    const infiniteGroups = Object.groupBy(infiniteEntities, (entityList) =>
      getGroupKey(entityList.operations)
    );

    // merge the entity and infinite entity groups
    const entityMapList = new Map<PropertyKey, Array<EntityList>>();
    for (const group of [groups, infiniteGroups]) {
      for (const [key, entityList] of Object.entries(group)) {
        if (!entityList || entityList.length === 0) continue;
        const existing = entityMapList.get(key) ?? [];
        if (existing.length === 0) {
          entityMapList.set(key, existing);
        }
        existing.push(...entityList);
      }
    }

    // flatten the groups
    // each group has a "unique" operation set for the purposes of providing the unified list
    const entityMap = new Map<PropertyKey, EntityList<T>>();
    for (const [key, entityLists] of entityMapList.entries()) {
      if (!entityLists || entityLists.length === 0) continue;
      const entityList: EntityList<T> = {
        data: entityLists
          .flatMap((entityList) => entityList.data)
          .map(entityMapper),

        operations: entityLists[0].operations,
      };
      entityMap.set(key, entityList);
    }

    return entityMap;
  });

  const filteredEntities = createMemo(() => {
    const requiredFilterFn = requiredFilter?.();
    const optionalFilterFn = optionalFilter?.();
    const searchFn = searchFilter?.();
    const entityGroupMap = allEntities();

    // apply filters + search filter to entities that haven't been operated on
    const entities: T[] = [];
    for (const entityList of entityGroupMap.values()) {
      const operations = getOperations(entityList.operations);
      let data = entityList.data;
      if (requiredFilterFn) data = data.filter(requiredFilterFn);
      if (optionalFilterFn && operations.filter)
        data = data.filter(optionalFilterFn);
      if (searchFn && operations.search) data = searchFn(data);
      entities.push(...data);
    }

    return entities;
  });

  const deduplicatedEntities = createMemo(() =>
    deduplicateEntities(filteredEntities())
  );

  const projectFilterEntities = createMemo(() => {
    const entities = deduplicatedEntities();
    if (showProjects()) {
      const projectEntityIds = new Set(
        entities.filter((e) => e.type === 'project').map((p) => p.id)
      );
      const currentProjectId = projectFilter?.();
      if (currentProjectId) {
        projectEntityIds.add(currentProjectId);
      }

      // filter out all entities that have a projectid included in projectEntities
      return entities.filter((e) => {
        if (e.type === 'project') return true;
        const projectId = getEntityProjectId(e);
        if (projectId) return projectEntityIds.has(projectId);
        return false;
      });
    } else {
      return entities.filter((e) => e.type !== 'project');
    }
  });

  const sortedEntities = createMemo<T[]>(() => {
    const entities = projectFilterEntities();
    const sortFn = entitySort?.();
    const searching = isSearchActive?.();

    if (searching) {
      return entities.toSorted(sortEntitiesForSearch);
    }

    if (!sortFn) return entities;

    return entities.toSorted(sortFn);
  });

  const isLoading = createMemo(() => {
    const fetching =
      entityInfiniteQueries.some((query) => query.query.isFetching) ||
      entityQueries?.some((query) => query.query.isFetching);
    return !!fetching;
  });

  const hasFinishedInitialLoad = createMemo(() => {
    const enabledInfinite = entityInfiniteQueries.filter(
      (q) => q.query.isEnabled
    );
    const enabledSingles =
      entityQueries?.filter((q) => q.query.isEnabled) ?? [];
    if (enabledInfinite.length + enabledSingles.length === 0) return true;

    return (
      enabledInfinite.every((q) => !q.query.isLoading) &&
      enabledSingles.every((q) => !q.query.isLoading)
    );
  });

  // debounce loading state to prevent flickering during a series of paginated fetches
  const [debouncedIsLoading, setDebouncedIsLoading] = createSignal(false);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const loading = isLoading();

    if (timeoutId) clearTimeout(timeoutId);

    if (loading) {
      setDebouncedIsLoading(true);
    } else {
      timeoutId = setTimeout(() => {
        setDebouncedIsLoading(false);
      }, DEBOUNCE_LOADING_STATE_MS);
    }

    onCleanup(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  });

  const [showNoResults, setShowNoResults] = createSignal(false);
  let noResultsTimeoutId: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      [() => sortedEntities().length, debouncedIsLoading],
      ([entitiesLength, loading]) => {
        if (noResultsTimeoutId) clearTimeout(noResultsTimeoutId);

        if (!loading && entitiesLength === 0) {
          noResultsTimeoutId = setTimeout(() => {
            setShowNoResults(true);
          }, DEBOUNCE_LOADING_STATE_MS + 50);
        } else if (entitiesLength > 0) {
          setShowNoResults(false);
        }
      }
    )
  );

  onCleanup(() => {
    if (noResultsTimeoutId) clearTimeout(noResultsTimeoutId);
  });

  let isFetchingMore = false;
  const fetchMoreData = async () => {
    if (isFetchingMore) return;

    isFetchingMore = true;
    const results = entityInfiniteQueries.map((query) => {
      if (
        query.query.isEnabled &&
        query.query.hasNextPage &&
        !query.query.isFetching
      ) {
        return query.query.fetchNextPage();
      }
    });

    await Promise.allSettled(results);
    isFetchingMore = false;
  };

  const debouncedFetchMore = debounce(fetchMoreData, DEBOUNCE_FETCH_MORE_MS);

  const DEFAULT_HEIGHT = 600;
  const [containerHeight, setContainerHeight] = createSignal(DEFAULT_HEIGHT);
  const UnifiedInfiniteList = (props: {
    children?: EntityRenderer<T>;
    entityListRef?: (ref: HTMLDivElement | undefined) => void;
    virtualizerHandle?: Setter<VirtualizerHandle | undefined>;
    emptyState?: JSX.Element;
    hasRefinementsFromBase?: Accessor<boolean>;
  }) => {
    const [listRef, setListRef] = createSignal<HTMLDivElement>();
    let containerSizeObserver: ResizeObserver | null = null;

    createEffect(() => {
      containerSizeObserver?.disconnect();
      const ref = listRef();
      if (!ref) return;

      // Initialize with current size of the container using this component
      const initial =
        ref.clientHeight ||
        ref.getBoundingClientRect().height ||
        DEFAULT_HEIGHT;
      setContainerHeight((prevHeight) => Math.max(prevHeight, initial));

      containerSizeObserver = new ResizeObserver((entries) => {
        const last = entries.pop();
        const nextHeight = last?.contentRect?.height ?? ref.clientHeight;
        if (Number.isFinite(nextHeight) && nextHeight > 0)
          setContainerHeight((prevHeight) => Math.max(prevHeight, nextHeight));
      });
      containerSizeObserver.observe(ref);
      onCleanup(() => containerSizeObserver?.disconnect());
    });

    // Estimate items per viewport and derive overscan and page size
    // Keep a conservative default item size for estimation; virtua will auto-measure precisely.
    const ENTITY_HEIGHT = 52;
    const viewportItemCount = createMemo(() =>
      Math.max(1, Math.ceil(containerHeight() / ENTITY_HEIGHT))
    );
    const computedOverscan = createMemo(() =>
      Math.max(6, Math.ceil(viewportItemCount() * 0.5))
    );

    const loadingCount = () =>
      entityQueries?.filter((query) => query.query.isLoading).length ??
      0 + entityInfiniteQueries.filter((query) => query.query.isLoading).length;

    const EntityRenderer = props.children ?? Entity;

    // Fetch more data if we filter out more items than the viewport can display
    // because it's possible that the match exists on the server
    createEffect(
      on(
        [sortedEntities, viewportItemCount, loadingCount],
        ([sortedEntities, viewportItemCount, loadingCount]) => {
          if (sortedEntities.length >= viewportItemCount) return;
          if (loadingCount > 0) return;
          debouncedFetchMore();
        }
      )
    );

    onCleanup(() => debouncedFetchMore.clear());

    return (
      <Switch>
        <Match
          when={
            hasFinishedInitialLoad() &&
            !props.hasRefinementsFromBase?.() &&
            sortedEntities().length === 0
          }
        >
          {props.emptyState}
        </Match>
        <Match when={showNoResults() && props.hasRefinementsFromBase?.()}>
          <div class="flex size-full p-4">
            <span class="font-mono text-ink-muted">No results found</span>
          </div>
          {/* TODO: Filtered Empty State */}
        </Match>
        <Match when={true}>
          <div class="flex size-full" ref={setListRef}>
            <StaticMarkdownContext>
              <Fragment
                ref={(el) => {
                  onElementConnect(el, () => {
                    props.entityListRef?.(el as HTMLDivElement);
                  });
                }}
              >
                <VList
                  ref={props.virtualizerHandle}
                  data={sortedEntitiesStore}
                  class={LIST_WRAPPER}
                  data-unified-entity-list
                  overscan={computedOverscan()}
                >
                  {(entity, index) => {
                    if (
                      untrack(index) ===
                      Math.floor(untrack(sortedEntities).length * 0.9)
                    )
                      debouncedFetchMore();
                    return <EntityRenderer entity={entity} index={index()} />;
                  }}
                </VList>
                {/* <div class={LIST_WRAPPER}>
                <Key each={sortedEntities()} by={(item) => item.id}>
                  {(entity, index) => {
                    if (
                      untrack(index) ===
                      Math.floor(untrack(sortedEntities).length * 0.9)
                    )
                      debouncedFetchMore();
                    return <EntityRenderer entity={entity()} index={index()} />;
                  }}
                </Key>
              </div> */}
              </Fragment>
            </StaticMarkdownContext>
          </div>
        </Match>
      </Switch>
    );
  };

  // need derived store to keep entities references stable, otherwise entities rerenders components
  createRenderEffect(() => {
    setSortedEntitiesStore(reconcile(sortedEntities(), { key: 'id' }));
  });

  return {
    UnifiedInfiniteList,
    UnifiedListComponent: UnifiedInfiniteList,
    entities: () => sortedEntitiesStore,
    isLoading: debouncedIsLoading,
  };
}
