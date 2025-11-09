import { StaticMarkdownContext } from 'core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from 'core/component/LexicalMarkdown/theme';
import { useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import type { Accessor, JSX, Setter } from 'solid-js';
import {
  createMemo,
  createSignal,
  mapArray,
  onCleanup,
  onMount,
  splitProps,
  untrack,
} from 'solid-js';
import { type VirtualizerHandle, VList, type VListProps } from 'virtua/solid';
import { LIST_WRAPPER } from '../constants/classStrings';
import type { EntityInfiniteQuery, EntityQuery } from '../queries/entity';
import type {
  EntityComparator,
  EntityData,
  EntityEnhancer,
  EntityFilter,
  EntityRenderer,
} from '../types/entity';
import { Entity } from './Entity';

type ChildlessVListProps<T extends EntityData> = Omit<
  VListProps<T>,
  'children' | 'data'
>;

interface UnifiedListProps<T extends EntityData>
  extends ChildlessVListProps<T> {
  entitiesData: T[];
  children?: EntityRenderer<T>;
}

export function UnifiedList<T extends EntityData>(props: UnifiedListProps<T>) {
  const [unifiedListProps, vListProps] = splitProps(props, [
    'entitiesData',
    'children',
  ]);

  return (
    <StaticMarkdownContext theme={unifiedListMarkdownTheme}>
      <VList
        data={unifiedListProps.entitiesData}
        class={LIST_WRAPPER}
        {...vListProps}
      >
        {(entity, index) =>
          unifiedListProps.children?.({ entity, index: index() }) ?? (
            <Entity entity={entity} />
          )
        }
      </VList>
    </StaticMarkdownContext>
  );
}

type EnhancedEntity<E> = E extends EntityEnhancer<infer T> ? T : never;
type FilteredEntity<F> = F extends EntityFilter<infer T> ? T : never;
type SortedEntity<S> = S extends EntityComparator<infer T> ? T : never;
type RequiredEntity<F, S> = FilteredEntity<F> & SortedEntity<S>;

interface UnifiedListContext {
  entityQueries: EntityQuery[];
  entityInfiniteQueries: EntityInfiniteQuery[];
}
export type UnifiedListComponent<T extends EntityData> = (props: {
  children: EntityRenderer<T>;
  ref?: Setter<VirtualizerHandle | undefined>;
}) => JSX.Element;
type UnifiedListReturn<T extends EntityData> = {
  UnifiedList: UnifiedListComponent<T>;
  entities: Accessor<T[]>;
  containerRef: Accessor<HTMLDivElement | undefined>;
  virtualizerHandle: Accessor<VirtualizerHandle | undefined>;
  hotkeyScope: string;
};

/**
 * Creates a unified list component for rendering a list of entities.
 * @param context - Non-reactive options for creating the list.
 * @param context.entityQueries - An array of entity queries for the list.
 * @param context.entityInfiniteQueries - An array of entity infinite queries for the list.
 * @param context.entityEnhancer - A function that will be called to enhance the entity data.
 * @param context.entityFilter - A function that will be called to filter the entity data.
 * @param context.entitySort - A function that will be called to sort the entity data.
 * @param context.entityClickHandler - An optional function that will be called with the entity data and event when an entity is clicked.
 * @returns A component that will render a list of entities. Props passed to this component are reactive.
 *
 * TODO: also returns functions for manipulating the list and/or component.
 */
export function createUnifiedList(
  context: UnifiedListContext
): UnifiedListReturn<EntityData>;

export function createUnifiedList<T extends EntityData>(
  context: UnifiedListContext,
  entityEnhancer: EntityEnhancer<T>
): UnifiedListReturn<T>;

export function createUnifiedList<
  T extends EntityData,
  F extends EntityFilter<T>,
  S extends EntityComparator<T>,
  E extends EntityEnhancer<RequiredEntity<F, S>>,
>(
  context: UnifiedListContext &
    (
      | {
          entityFilter: Accessor<F>;
        }
      | {
          entitySort: Accessor<S>;
        }
      | {
          entityFilter: Accessor<F>;
          entitySort: Accessor<S>;
        }
    ),
  entityEnhancer?: E
): UnifiedListReturn<EnhancedEntity<E>>;

export function createUnifiedList<
  T extends EntityData,
  F extends EntityFilter<T>,
  S extends EntityComparator<T>,
  E extends EntityEnhancer<RequiredEntity<F, S>>,
>(
  {
    entityQueries,
    entityInfiniteQueries,
    entityFilter,
    entitySort,
  }: UnifiedListContext & {
    entityFilter?: Accessor<F>;
    entitySort?: Accessor<S>;
  },
  entityEnhancer?: E
): UnifiedListReturn<T> {
  let isFetchingMore = false;
  const fetchMorePages = async () => {
    if (isFetchingMore) return;

    isFetchingMore = true;
    const results = entityInfiniteQueries.map((query) => {
      if (query.hasNextPage && !query.isFetching) return query.fetchNextPage();
    });

    await Promise.allSettled(results);
    isFetchingMore = false;
  };

  const entities = createMemo<EntityData[]>(() => [
    ...entityQueries.flatMap((query) => (query.isSuccess ? query.data : [])),
    ...entityInfiniteQueries.flatMap((query) =>
      query.isSuccess ? query.data : []
    ),
  ]);

  const enhancedEntities = entityEnhancer
    ? mapArray(entities, (entity, index) =>
        entityEnhancer(entity, index(), entities())
      )
    : (entities as Accessor<T[]>);

  const filteredEntities = createMemo<T[]>(() => {
    const entityFilterFn = entityFilter?.();
    if (entityFilterFn) return enhancedEntities().filter(entityFilterFn);

    return enhancedEntities();
  });

  const sortedEntities = createMemo<T[]>(() => {
    const entitySortFn = entitySort?.();
    if (entitySortFn) return filteredEntities().toSorted(entitySortFn);

    return filteredEntities();
  });

  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('unified-list');
  const UnifiedListComponent: UnifiedListComponent<T> = (props) => {
    onMount(() => {
      const ref = containerRef();
      if (!ref) return;

      attachHotkeys(ref);
    });

    onCleanup(() => {
      setContainerRef(undefined);
      setVirtualizerHandle(undefined);
    });

    return (
      <div ref={setContainerRef} class="contents">
        <UnifiedList
          entitiesData={sortedEntities()}
          ref={(handle) => {
            if (!handle) return;

            setVirtualizerHandle(handle);
            props.ref?.(handle);
          }}
        >
          {(data) => {
            if (data.index === Math.floor(untrack(sortedEntities).length * 0.9))
              fetchMorePages();

            return props.children(data);
          }}
        </UnifiedList>
      </div>
    );
  };

  return {
    UnifiedList: UnifiedListComponent,
    entities: sortedEntities,
    containerRef,
    virtualizerHandle,
    hotkeyScope,
  };
}
