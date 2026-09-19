import type { Accessor } from 'solid-js';

/**
 * Reactive data and loading controls consumed by a list independently of its
 * query implementation.
 */
export type ListDataSource<TItem> = {
  items: Accessor<readonly TItem[]>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  error: Accessor<unknown | undefined>;
  hasMore: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
};

/** Wraps local reactive items in the same contract as query-backed lists. */
export function createStaticListDataSource<TItem>(
  items: Accessor<readonly TItem[]>
): ListDataSource<TItem> {
  const falseAccessor = () => false;
  const noError = () => undefined;
  const noOp = () => Promise.resolve();

  return {
    items,
    isLoading: falseAccessor,
    isFetching: falseAccessor,
    error: noError,
    hasMore: falseAccessor,
    isLoadingMore: falseAccessor,
    loadMore: noOp,
    refresh: noOp,
  };
}
