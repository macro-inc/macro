import type { UrqlQueryResult } from '@app/lib/urql-solid/types';
import { normalizedCacheResultMetadata } from '@graphql-cache/index';
import type { AnyVariables, CombinedError, OperationResult } from '@urql/core';
import { createSignal } from 'solid-js';

/**
 * A catalog list that always has data: an empty list stands in until the
 * first answer, so readers render at once and never suspend.
 */
export type CatalogListResult<T> = {
  readonly data: T[];
  readonly error: CombinedError | null;
  /** Never: the empty list stands in. Use `isPlaceholderData` for "not yet". */
  readonly isPending: false;
  readonly isLoading: false;
  readonly isSuccess: boolean;
  readonly isError: boolean;
  /** Answered at least once, from the cache or the server, or failed. */
  readonly isFetched: boolean;
  readonly isFetching: boolean;
  /** The list is the empty stand-in, not an answer. */
  readonly isPlaceholderData: boolean;
  /** When the list last changed from anything newer than the stored cache. */
  readonly dataUpdatedAt: number;
  refetch(): Promise<unknown>;
};

/** Stamps results that carry news: a server answer or a local write. */
export function createListedAt() {
  const [listedAt, setListedAt] = createSignal(0);
  return {
    listedAt,
    onResult(result: OperationResult<unknown, AnyVariables>) {
      if (result.data == null) return;
      if (
        normalizedCacheResultMetadata(result)?.source === 'normalized-cache-hit'
      )
        return;
      setListedAt(Date.now());
    },
  };
}

export function catalogListResult<T, V extends AnyVariables, Q>(
  query: UrqlQueryResult<T[], V, Q>,
  listedAt: () => number,
  empty: T[]
): CatalogListResult<T> {
  return {
    get data() {
      return query.data ?? empty;
    },
    get error() {
      return query.error;
    },
    isPending: false,
    isLoading: false,
    get isSuccess() {
      return !query.error;
    },
    get isError() {
      return !!query.error;
    },
    get isFetched() {
      return query.data !== undefined || !!query.error;
    },
    get isFetching() {
      return query.isFetching;
    },
    get isPlaceholderData() {
      return query.data === undefined;
    },
    get dataUpdatedAt() {
      return listedAt();
    },
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}
