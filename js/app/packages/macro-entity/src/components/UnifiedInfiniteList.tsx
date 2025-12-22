import { useSuspenseContext } from '@app/component/SuspenseContext';
import { EmptyState } from '@app/component/UnifiedListEmptyState';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import type { ViewId } from '@core/types/view';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { debounce } from '@solid-primitives/scheduled';
import { createVirtualizer, type Virtualizer } from '@tanstack/solid-virtual';
import { StaticMarkdownContext } from 'core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  type Accessor,
  createComputed,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  type Setter,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type {
  EntityInfiniteQuery,
  EntityList,
  EntityQuery,
  EntityQueryOperations,
  EntityQueryWithOperations,
} from '../queries/entity';
import { isSearchEntity } from '../queries/search';
import type {
  EntitiesFilter,
  EntityComparator,
  EntityData,
  EntityFilter,
  EntityMapper,
  EntityRenderer,
} from '../types/entity';
import type { WithSearch } from '../types/search';
import { Entity } from './Entity';

const cacheMap = new Map<
  string,
  {
    offset: number;
    cache?: any; // TBD
  }
>();

/**
 * Merges search data from two entities, preferring service source with local as fallback.
 * - Uses service entity as base
 * - Falls back to local nameHighlight if service doesn't have one
 * - Falls back to local contentHighlights if service doesn't have any
 * - Preserves 'local' source if either entity is local (for stable ordering)
 */
const mergeSearchEntities = <T extends EntityData>(
  first: WithSearch<T>,
  second: WithSearch<T>
): WithSearch<T> => {
  const serviceEntity = first.search.source === 'service' ? first : second;
  const localEntity = first.search.source === 'local' ? first : second;
  const hasLocal =
    first.search.source === 'local' || second.search.source === 'local';

  return {
    ...serviceEntity,
    search: {
      ...serviceEntity.search,
      source: hasLocal ? 'local' : 'service',
      nameHighlight:
        serviceEntity.search.nameHighlight || localEntity.search.nameHighlight,
      contentHitData: serviceEntity.search.contentHitData?.length
        ? serviceEntity.search.contentHitData
        : localEntity.search.contentHitData,
    },
  };
};

/**
 * Gets the timestamp of an entity (updatedAt or createdAt)
 */
const getEntityTimestamp = (entity: EntityData): number => {
  return entity.updatedAt ?? entity.createdAt ?? 0;
};

/**
 * Returns true if the new entity should replace the existing one based on timestamp. If the timestamp is the same, prefer to use the newer entity to handle optimistic updates
 */
const isNewerEntity = (
  newEntity: EntityData,
  existing: EntityData
): boolean => {
  return getEntityTimestamp(newEntity) >= getEntityTimestamp(existing);
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
 * Sorts entities for search mode
 */
const sortEntitiesForSearch = <T extends EntityData>(a: T, b: T): number => {
  const channelsFirst = (a: WithSearch<T>, b: WithSearch<T>) => {
    if (a.type === 'channel' && b.type !== 'channel') return -1;
    if (a.type !== 'channel' && b.type === 'channel') return 1;
    return 0;
  };

  const localFirst = (a: WithSearch<T>, b: WithSearch<T>) => {
    if (a.search.source === 'local' && b.search.source !== 'local') return -1;
    if (a.search.source !== 'local' && b.search.source === 'local') return 1;
    return 0;
  };

  if (isSearchEntity(a) && isSearchEntity(b)) {
    return channelsFirst(a, b) || localFirst(a, b);
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
  id: string;
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
  searchFilter?: Accessor<EntitiesFilter<T> | undefined>;
  isSearchActive?: Accessor<boolean>;
  disableFetchMore?: Accessor<boolean>;
}

export function createUnifiedInfiniteList<T extends EntityData>({
  id,
  entityInfiniteQueries,
  entityQueries,
  entityMapper = (entity: EntityData) => entity as T,
  requiredFilter,
  optionalFilter,
  entitySort,
  searchFilter,
  isSearchActive,
  disableFetchMore,
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

  const sortedEntities = createMemo<T[]>(() => {
    const entities = deduplicatedEntities();
    const sortFn = entitySort?.();
    const searching = isSearchActive?.();

    if (searching) {
      // NOTE: the default sort will be channels, then local fuzzy name, then search service
      // avoiding doing an extra sort as a speed optimization
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

  let isFetchingMore = false;
  const fetchMoreData = async () => {
    if (disableFetchMore?.() || isFetchingMore) return;

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
    virtualizerHandle?: Setter<Virtualizer<Element, Element> | undefined>;
    hasRefinementsFromBase?: boolean;
    viewId?: ViewId;
    searchText?: string;
  }) => {
    const [scrollParentRef, setScrollParentRef] =
      createSignal<HTMLDivElement>();

    // Estimate items per viewport and derive overscan and page size
    // Keep a conservative default item size for estimation; virtua will auto-measure precisely.
    const ENTITY_HEIGHT = 40;
    const viewportItemCount = createMemo(() =>
      Math.max(1, Math.ceil(containerHeight() / ENTITY_HEIGHT))
    );
    const computedOverscan = createMemo(() =>
      Math.max(6, Math.ceil(viewportItemCount() * 0.5))
    );
    const rowVirtualizer = createVirtualizer({
      get count() {
        return sortedEntitiesStore.length;
      },
      estimateSize: () => ENTITY_HEIGHT,
      getScrollElement: () => scrollParentRef() as Element,
      overscan: computedOverscan(),
    });

    props.virtualizerHandle?.(rowVirtualizer);

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

    // const cacheKey = createMemo(() => (id ? `list-cache-${id}` : null));
    const cacheKey = `list-cache-${id}`;

    // compose method to cache scroll position when called
    const scrollToIndex = rowVirtualizer.scrollToIndex;
    rowVirtualizer.scrollToIndex = (
      index: number,
      options?: ScrollToOptions | undefined
    ) => {
      // @ts-expect-error
      scrollToIndex(index, options);
      requestAnimationFrame(() => {
        cacheVirtualizerHandle();
      });
    };

    // Restore scroll position on mount
    const restoreScrollPosition = () => {
      const { offset: cachedOffset } = cacheMap.get(cacheKey) || { offset: 0 };
      if (rowVirtualizer && cachedOffset != null) {
        rowVirtualizer.scrollToOffset(cachedOffset);
      }
    };

    const cacheVirtualizerHandle = () => {
      const key = cacheKey;

      const scrollOffset = rowVirtualizer.scrollOffset;
      if (rowVirtualizer && key) {
        cacheMap.set(key, { offset: scrollOffset ?? 0 });
      }
    };

    let scrollMounted = false;
    createEffect(
      on(scrollParentRef, (scrollParentRef, prev) => {
        if (scrollParentRef && prev == null) {
          scrollMounted = true;
          restoreScrollPosition();
        }
      })
    );

    const { isPending } = useSuspenseContext();

    // Save scroll position and cache on cleanup
    onCleanup(() => {
      cacheVirtualizerHandle();
    });

    // Restore scroll after Suspense
    createComputed(
      on(
        isPending,
        (isPending, prevIsPending) => {
          if (isPending) {
            if (scrollMounted) {
              cacheVirtualizerHandle();
            }
          }
          if (isPending === false && prevIsPending === true) {
            queueMicrotask(() => {
              restoreScrollPosition();
            });
          }
        },
        { defer: true }
      )
    );

    // stable empty state
    const entityCount = createMemo(() => sortedEntities().length);
    const [showEmptyState, setShowEmptyState] = createSignal<boolean>(false);
    const [loadFinished, setLoadFinished] = createSignal<boolean>(false);
    createEffect(() => {
      if (entityCount() === 0) {
        setLoadFinished(false);
        let count = 0;
        const timeoutId = setInterval(() => {
          const countExceeded = ++count > 10;
          if (countExceeded) {
            console.warn('Too many interval iterations');
          }

          if (loadFinished() || countExceeded) clearInterval(timeoutId);
          if (entityCount() === 0 && !debouncedIsLoading()) {
            setLoadFinished(true);
          }
        }, 500);
      }
    });
    createEffect(() => {
      if (hasFinishedInitialLoad() && !debouncedIsLoading()) {
        setLoadFinished(true);
      }
    });
    createEffect(() => {
      if (entityCount() > 0) {
        setShowEmptyState(false);
        return;
      }
      setShowEmptyState(loadFinished());
    });

    return (
      <Switch>
        <Match when={showEmptyState()}>
          <EmptyState
            viewId={props.viewId}
            search={!!props.searchText}
            hasRefinementsFromBase={props.hasRefinementsFromBase}
          />
        </Match>
        <Match when={true}>
          <div class="flex size-full relative" ref={setListRef}>
            <StaticMarkdownContext>
              <div
                class="size-full relative scrollbar-hidden"
                data-unified-entity-list
                ref={(el) => {
                  onElementConnect(el, () => {
                    setScrollParentRef(el as HTMLDivElement);
                  });
                }}
                style={{
                  overflow: 'auto',
                }}
              >
                <div
                  ref={(el) => {
                    onElementConnect(el, () => {
                      props.entityListRef?.(el as HTMLDivElement);
                    });
                  }}
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${rowVirtualizer.getVirtualItems()?.[0]?.start}px)`,
                    }}
                  >
                    <For each={rowVirtualizer.getVirtualItems()}>
                      {(virtualItem) => {
                        if (
                          untrack(() => virtualItem.index) >=
                          Math.floor(untrack(sortedEntities).length * 0.9)
                        ) {
                          debouncedFetchMore();
                        }

                        return (
                          <Show
                            when={sortedEntitiesStore[virtualItem.index]?.id}
                            keyed
                          >
                            {(_) => {
                              const entity =
                                sortedEntitiesStore[virtualItem.index];
                              return (
                                <Show when={entity}>
                                  <div
                                    data-index={virtualItem.index}
                                    ref={(el) =>
                                      queueMicrotask(() =>
                                        rowVirtualizer.measureElement(el)
                                      )
                                    }
                                  >
                                    <EntityRenderer
                                      entity={entity}
                                      index={virtualItem.index}
                                    />
                                  </div>
                                </Show>
                              );
                            }}
                          </Show>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </div>
            </StaticMarkdownContext>
            <CustomScrollbar
              scrollContainer={() => {
                // Find the actual scroll container (VList creates its own scroll container)
                const listEl = listRef();
                if (!listEl) return undefined;
                const scrollContainer = listEl.querySelector(
                  '[data-unified-entity-list]'
                ) as HTMLElement;
                return scrollContainer || undefined;
              }}
            />
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
