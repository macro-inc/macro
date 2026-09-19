import { type Accessor, createSignal, onCleanup } from 'solid-js';
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

  const target = (direction: -1 | 1): NavigationStep<TEntity> | undefined => {
    const items = options.source.items();
    const currentIndex = items.findIndex(
      (item) => options.getEntity(item)?.id === options.currentId()
    );
    if (currentIndex === -1) return;

    for (
      let index = currentIndex + direction;
      index >= 0 && index < items.length;
      index += direction
    ) {
      const item = items[index];
      if (!item) continue;

      const entity = options.getEntity(item);
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
      void navigate(-1);
    },
    next: () => {
      void navigate(1);
    },
    navigate,
    open,
  };
}
