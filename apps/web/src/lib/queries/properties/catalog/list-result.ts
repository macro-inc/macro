import type { UrqlQueryResult } from '@app/lib/urql-solid/types';
import { normalizedCacheResultMetadata } from '@graphql-cache/index';
import { onlineManager } from '@tanstack/solid-query';
import {
  type AnyVariables,
  type CombinedError,
  createRequest,
  type DocumentInput,
  type OperationResult,
} from '@urql/core';
import { type Accessor, createMemo, createSignal } from 'solid-js';

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

export type CatalogListStamp = {
  /** When the list last changed from anything newer than the stored cache. */
  listedAt: () => number;
  /** The server's refusal of the current read, if it stands. */
  refusal: () => CombinedError | null;
};

// Refusals kept per reader: the reads it switched away from, newest last.
const MAX_REFUSALS = 16;

/**
 * Follows a reader's results: stamps those that carry news (a server answer
 * or a local write), and keeps the server's refusal of each read (each
 * operation key) until the server answers that read successfully. The cache
 * republishes a list it still holds, with no error, whenever a record it
 * reads changes; a list the server refused (its definition deleted, or no
 * longer visible to the viewer) would come back on screen from the cache.
 * TanStack kept a refused read failed until its next successful fetch. A
 * failure that reached no server neither sets nor clears a refusal.
 *
 * The current read is keyed from the reader's own document and variables, as
 * urql keys its operation, so a reader that switches back to a refused read
 * reports the refusal before that read answers again.
 */
export function createListedAt<V extends AnyVariables>(
  document: DocumentInput<unknown, V>,
  variables: Accessor<V | undefined>
): CatalogListStamp & {
  onResult(result: OperationResult<unknown, AnyVariables>): void;
} {
  const currentKey = createMemo(() => {
    const value = variables();
    return value === undefined ? undefined : createRequest(document, value).key;
  });
  const [listedAt, setListedAt] = createSignal(0);
  const [refusals, setRefusals] = createSignal<
    ReadonlyMap<number, CombinedError>
  >(new Map());
  const update = (key: number, error: CombinedError | undefined) => {
    if (!error && !refusals().has(key)) return;
    const next = new Map(refusals());
    next.delete(key);
    if (error) next.set(key, error);
    for (const oldest of next.keys()) {
      if (next.size <= MAX_REFUSALS) break;
      next.delete(oldest);
    }
    setRefusals(next);
  };
  return {
    listedAt,
    refusal() {
      const key = currentKey();
      if (key === undefined) return null;
      return refusals().get(key) ?? null;
    },
    onResult(result) {
      // A client without the normalized cache answers only from the server.
      const metadata = normalizedCacheResultMetadata(result);
      const source = metadata?.source;
      const fromServer = !metadata || source === 'live-network';
      const key = result.operation.key;
      if (result.error?.graphQLErrors.length) update(key, result.error);
      else if (fromServer && !result.error && result.data != null)
        update(key, undefined);
      if (result.data == null || source === 'normalized-cache-hit') return;
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
  stamp: CatalogListStamp,
  empty: T[]
): CatalogListResult<T> {
  const query = offlineAsSuccess(source);
  // A standing refusal outlasts the cache's later rereads of the same read.
  const error = () => stamp.refusal() ?? query.error;
  return {
    get data() {
      return query.data ?? empty;
    },
    get error() {
      return error();
    },
    isPending: false,
    isLoading: false,
    get isSuccess() {
      return !error();
    },
    get isError() {
      return !!error();
    },
    get isFetched() {
      return query.data !== undefined || !!error();
    },
    get isFetching() {
      return query.isFetching;
    },
    get isPlaceholderData() {
      return query.data === undefined && !error();
    },
    get dataUpdatedAt() {
      return stamp.listedAt();
    },
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}
