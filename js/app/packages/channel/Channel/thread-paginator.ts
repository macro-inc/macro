import type { UseInfiniteQueryResult } from '@tanstack/solid-query';
import { createSignal, type Accessor, type Setter } from 'solid-js';
import type { Store } from 'solid-js/store';

export type ThreadPaginator = {
  isPrepending: Accessor<boolean>;
  isShifting: Accessor<boolean>;
  prependPaginate: () => Promise<void>;
  shiftPaginate: () => Promise<void>;
  hasMorePrepend: Accessor<boolean>;
  hasMoreShifting: Accessor<boolean>;
};

type PaginateDirectionState = {
  direction: 'shift' | 'prepend';
  pending: Accessor<boolean>;
  is: Accessor<boolean>;
  setIsPending: Setter<boolean>;
  setIs: Setter<boolean>;
  more: Accessor<boolean>;
  setMore: Setter<boolean>;
};

function createPaginateDirectionState(
  direction: 'shift' | 'prepend'
): Store<PaginateDirectionState> {
  const [pending, setIsPending] = createSignal<boolean>(false);
  const [is, setIs] = createSignal<boolean>(false);
  const [more, setMore] = createSignal<boolean>(false);
  return {
    direction,
    pending,
    is,
    setIsPending,
    setIs,
    more,
    setMore,
  };
}

export function createThreadPaginator<T>(
  query: UseInfiniteQueryResult<T>
): ThreadPaginator {
  const prependPaginateState = createPaginateDirectionState('prepend');
  const shiftPaginateState = createPaginateDirectionState('shift');

  const paginate = async (state: PaginateDirectionState) => {
    const hasMore = () =>
      state.direction === 'shift' ? query.hasNextPage : query.hasPreviousPage;
    const isFetching = () =>
      state.direction === 'shift'
        ? query.isFetchingNextPage
        : query.isFetchingPreviousPage;
    const paginateFn =
      state.direction === 'shift'
        ? query.fetchNextPage
        : query.fetchPreviousPage;

    state.setMore(hasMore());

    if (!hasMore()) return;
    if (isFetching() || state.is()) {
      state.setIsPending(true);
      return;
    }

    state.setIs(true);

    try {
      do {
        state.setIsPending(false);
        await paginateFn();
      } while (hasMore() && state.pending());
    } finally {
      state.setIs(false);
      state.setIsPending(false);
    }
  };

  return {
    hasMorePrepend: prependPaginateState.more,
    hasMoreShifting: shiftPaginateState.more,
    isPrepending: prependPaginateState.is,
    isShifting: shiftPaginateState.is,
    prependPaginate: () => paginate(prependPaginateState),
    shiftPaginate: () => paginate(shiftPaginateState),
  };
}
