import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import type { ListDataSource } from './list-data-source';

export type ListDetailNavigationTarget = {
  canPrevious: Accessor<boolean>;
  canNext: Accessor<boolean>;
  previous: () => void;
  next: () => void;
};

export type ListDetailNavigationOptions<TEntity> = {
  fallbackDirection?: -1 | 1;
  beforeOpen?: (
    next: TEntity | undefined,
    current: TEntity | undefined
  ) => boolean | void;
};

export type ListDetailNavigation<TEntity> = ListDetailNavigationTarget & {
  navigate: (
    direction: -1 | 1,
    options?: ListDetailNavigationOptions<TEntity>
  ) => Promise<void>;
  open: (entity: TEntity) => void;
};

type NavigationStep<TEntity> =
  | { kind: 'entity'; entity: TEntity }
  | { kind: 'continuation'; load: () => Promise<unknown> };

export function useListDetailNavigation<
  TItem,
  TEntity extends { id: string },
>(options: {
  currentId: Accessor<string>;
  source: Pick<
    ListDataSource<TItem>,
    'items' | 'hasMore' | 'loadMore' | 'error'
  >;
  getEntity: (item: TItem) => TEntity | undefined;
  getContinuation?: (item: TItem) => (() => Promise<unknown>) | undefined;
  open: (entity: TEntity) => void;
  onError?: (error: unknown) => void;
}): ListDetailNavigation<TEntity> {
  const [navigating, setNavigating] = createSignal(false);
  let disposed = false;

  onCleanup(() => {
    disposed = true;
  });

  const isCurrent = (id: string) => !disposed && options.currentId() === id;
  const currentEntity = () =>
    options.source
      .items()
      .map(options.getEntity)
      .find((entity) => entity?.id === options.currentId());

  // Where the open entity sat when it was opened. Next and previous step
  // from there even after it moves (a reply draft lifts a thread to the top
  // of Signal) or leaves the list (a reply marks it done, another device
  // archives it).
  const anchor = createMemo<
    { id: string; next: string[]; previous: string[] } | undefined
  >((previous) => {
    const id = options.currentId();
    if (previous?.id === id) return previous;
    const ids = options.source.items().flatMap((item) => {
      const entity = options.getEntity(item);
      return entity ? [entity.id] : [];
    });
    const index = ids.indexOf(id);
    if (index === -1) return undefined;
    return {
      id,
      next: ids.slice(index + 1),
      previous: ids.slice(0, index).reverse(),
    };
  });

  const startIndex = (items: readonly TItem[], direction: -1 | 1) => {
    const indexById = new Map<string, number>();
    items.forEach((item, index) => {
      const entity = options.getEntity(item);
      if (entity) indexById.set(entity.id, index);
    });
    const id = options.currentId();
    const position = anchor();
    if (position?.id !== id) {
      const current = indexById.get(id);
      return current === undefined ? undefined : current + direction;
    }
    // The entity sat just after its nearest surviving earlier neighbour, so
    // stepping forward starts there, through any load-more row in between.
    for (const neighbour of position.previous) {
      const index = indexById.get(neighbour);
      if (index !== undefined) return direction === 1 ? index + 1 : index;
    }
    // Otherwise the nearest surviving later neighbour took its place.
    for (const neighbour of position.next) {
      const index = indexById.get(neighbour);
      if (index !== undefined) return direction === 1 ? index : index - 1;
    }
    // No neighbour it was opened beside remains (it was the only row loaded):
    // step from where it is now.
    const current = indexById.get(id);
    return current === undefined ? undefined : current + direction;
  };

  const target = (direction: -1 | 1): NavigationStep<TEntity> | undefined => {
    const items = options.source.items();
    const start = startIndex(items, direction);
    if (start === undefined) return;

    for (
      let index = start;
      index >= 0 && index < items.length;
      index += direction
    ) {
      const item = items[index];
      if (!item) continue;

      const entity = options.getEntity(item);
      // The open entity itself may have moved into the path.
      if (entity?.id === options.currentId()) continue;
      if (entity) return { kind: 'entity', entity };

      const load =
        direction === 1 ? options.getContinuation?.(item) : undefined;
      if (load) return { kind: 'continuation', load };
    }

    if (direction === 1 && options.source.hasMore()) {
      return { kind: 'continuation', load: options.source.loadMore };
    }
  };

  const resolve = async (
    direction: -1 | 1,
    currentId: string
  ): Promise<TEntity | undefined> => {
    while (isCurrent(currentId)) {
      const step = target(direction);
      if (!step) return;
      if (step.kind === 'entity') return step.entity;

      await step.load();
      if (!isCurrent(currentId)) return;

      const error = options.source.error();
      if (error) throw error;
    }
  };

  const open = (entity: TEntity) => {
    if (!disposed) options.open(entity);
  };

  const navigate = async (
    direction: -1 | 1,
    navigationOptions: ListDetailNavigationOptions<TEntity> = {}
  ) => {
    if (disposed || navigating()) return;
    setNavigating(true);
    const currentId = options.currentId();
    const current = currentEntity();

    try {
      let next = await resolve(direction, currentId);
      if (
        !next &&
        navigationOptions.fallbackDirection !== undefined &&
        isCurrent(currentId)
      ) {
        next = await resolve(navigationOptions.fallbackDirection, currentId);
      }
      if (!isCurrent(currentId)) return;
      if (navigationOptions.beforeOpen?.(next, current) === false) return;
      if (next) open(next);
    } catch (error) {
      if (isCurrent(currentId)) options.onError?.(error);
    } finally {
      setNavigating(false);
    }
  };

  return {
    canPrevious: () => !navigating() && target(-1)?.kind === 'entity',
    canNext: () => !navigating() && target(1) !== undefined,
    previous: () => {
      fireAndForget(navigate(-1), 'list-detail-navigation');
    },
    next: () => {
      fireAndForget(navigate(1), 'list-detail-navigation');
    },
    navigate,
    open,
  };
}
