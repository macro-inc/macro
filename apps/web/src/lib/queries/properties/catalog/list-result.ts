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

// Whether each failure reached no server while the app was offline, decided
// when it is first read: a failure stays paused until the next result
// replaces it, as a paused TanStack read stayed successful until it resumed.
const OFFLINE_AT_FAILURE = new WeakMap<CombinedError, boolean>();

/**
 * A read that failed because the app is offline, over a list it already has.
 * TanStack paused such reads and kept their success; the cache answers them
 * with a network error, which readers would show as a failure. Offline is
 * the app's network status (`onlineManager`, the native network path on iOS
 * and Android). A failure with an HTTP status came from a server, so it is
 * a refusal, never a pause.
 */
export function isOfflineFailure(
  error: CombinedError | null,
  hasData: boolean
): boolean {
  if (!error || !hasData) return false;
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

/** A query result that reports an offline failure over its data as success. */
export function offlineAsSuccess<D, V extends AnyVariables, Q>(
  query: UrqlQueryResult<D, V, Q>
): UrqlQueryResult<D, V, Q> {
  const paused = () => isOfflineFailure(query.error, query.data !== undefined);
  const overrides: Partial<Record<string | symbol, () => unknown>> = {
    error: () => null,
    isError: () => false,
    isSuccess: () => true,
    status: () => 'success',
  };
  return new Proxy(query, {
    get(target, key) {
      const override = overrides[key];
      return override && paused() ? override() : Reflect.get(target, key);
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
      return query.data === undefined;
    },
    get dataUpdatedAt() {
      return listedAt();
    },
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}
