import type { UrqlQueryResult } from '@app/lib/urql-solid/types';
import { normalizedCacheResultMetadata } from '@graphql-cache/index';
import { onlineManager } from '@tanstack/solid-query';
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
  /**
   * The list is the empty stand-in, not an answer, and the read has not
   * failed: a failed read is not placeholder data, as in TanStack.
   */
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

// Whether each failure reached no server while the app was offline, decided
// when it is first read: a failure stays paused until the next result
// replaces it, as a paused TanStack read stayed successful until it resumed.
const OFFLINE_AT_FAILURE = new WeakMap<CombinedError, boolean>();

/**
 * A read that failed because the app is offline. TanStack paused such reads:
 * one over a list it already had stayed successful, and a first read stayed
 * pending (with its placeholder, where it had one) until the app came back
 * online. The cache answers them with a network error, which readers would
 * show as a failure. Offline is the app's network status (`onlineManager`,
 * the native network path on iOS and Android). A failure with an HTTP status
 * came from a server, so it is a refusal, never a pause.
 */
export function isOfflineFailure(error: CombinedError | null): boolean {
  if (!error) return false;
  let offline = OFFLINE_AT_FAILURE.get(error);
  if (offline === undefined) {
    const status = (error.response as { status?: unknown } | undefined)?.status;
    offline =
      !!error.networkError &&
      error.graphQLErrors.length === 0 &&
      status === undefined &&
      !onlineManager.isOnline();
    OFFLINE_AT_FAILURE.set(error, offline);
  }
  return offline;
}

const PAUSED_OVER_DATA: Partial<Record<string | symbol, () => unknown>> = {
  error: () => null,
  isError: () => false,
  isSuccess: () => true,
  status: () => 'success',
};
const PAUSED_FIRST_READ: Partial<Record<string | symbol, () => unknown>> = {
  error: () => null,
  isError: () => false,
  isSuccess: () => false,
  isPending: () => true,
  isLoading: () => false,
  isFetching: () => false,
  status: () => 'pending',
};

/**
 * A query result that reports an offline failure as a paused read: a success
 * over the data it has, or still pending when it has none.
 */
export function offlineAsSuccess<D, V extends AnyVariables, Q>(
  query: UrqlQueryResult<D, V, Q>
): UrqlQueryResult<D, V, Q> {
  return new Proxy(query, {
    get(target, key) {
      if (!isOfflineFailure(query.error)) return Reflect.get(target, key);
      const overrides =
        query.data === undefined ? PAUSED_FIRST_READ : PAUSED_OVER_DATA;
      const override = overrides[key];
      return override ? override() : Reflect.get(target, key);
    },
  });
}

export function catalogListResult<T, V extends AnyVariables, Q>(
  source: UrqlQueryResult<T[], V, Q>,
  listedAt: () => number,
  empty: T[]
): CatalogListResult<T> {
  const query = offlineAsSuccess(source);
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
      return query.data === undefined && !query.error;
    },
    get dataUpdatedAt() {
      return listedAt();
    },
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}
