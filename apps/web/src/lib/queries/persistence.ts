import {
  type ParsedDuration,
  parsedDurationToMilliseconds,
} from '@core/util/dateSearch/dateParser';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  notifyManager,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/query-core';
import type {
  ClearablePerQueryPersistence,
  PersistedQueryEntry,
} from './persistence/per-query-idb';

export type PersistenceKey = `${string}-persist-v${number}`;

/** Builds a versioned persistence key for IDB database naming. */
export function createPersistenceKey(
  name: string,
  version: number
): PersistenceKey {
  return `${name}-persist-v${version}`;
}

export type PersistScope = Readonly<{
  store: ClearablePerQueryPersistence;
  /** Omit to retain same-buster entries regardless of their age. */
  maxAge?: ParsedDuration;
  buster: string;
  shouldPersist: (queryKey: QueryKey) => boolean;
  shouldRestore?: (queryKey: QueryKey) => boolean;
  /** Reject persisted values before publishing them to query observers. */
  shouldRestoreData?: (data: unknown) => boolean;
}>;

export type QueryPersistence = {
  /** Restore this query without starting or waiting for its network request. */
  restoreQuery: (queryKey: QueryKey) => Promise<void>;
  /** Clear every durable scope and fence pending hydration on account changes. */
  clear: () => Promise<void>;
  /** Await pending local writes before restarting the native app. */
  flush: () => Promise<void>;
  dispose: () => void;
};

/**
 * Validates a persisted entry against the current cache-buster and optional
 * max age.
 * Returns 'valid' if the entry can be restored, or a reason string
 * explaining why it should be discarded.
 */
function validatePersistedEntry(
  entry: PersistedQueryEntry,
  buster: string,
  maxAgeMs?: number
): 'valid' | 'buster_mismatch' | 'expired' {
  if (entry.buster !== buster) return 'buster_mismatch';
  if (maxAgeMs !== undefined && Date.now() - entry.dataUpdatedAt > maxAgeMs) {
    return 'expired';
  }
  return 'valid';
}

/**
 * Attempts to restore a query's data from IDB when the query is first added
 * to the cache. Validates the entry and guards against race conditions where
 * a fresh fetch resolves before the IDB read completes.
 */
async function handleRestore(
  queryClient: QueryClient,
  scope: PersistScope,
  query: Query,
  isCurrent: () => boolean
): Promise<void> {
  if (scope.shouldRestore && !scope.shouldRestore(query.queryKey)) return;

  const state = query.state;
  if (state.data !== undefined) return;

  let entry: PersistedQueryEntry | undefined;
  try {
    entry = await scope.store.get(query.queryHash);
  } catch {
    console.error('[query] IDB persistence read failed');
    return;
  }

  // Removal/recreation, disposal, or a fresh update (including logout) fences
  // an older IDB read even when the replacement query is pending or errored.
  if (
    !entry ||
    !isCurrent() ||
    query.state.dataUpdateCount !== state.dataUpdateCount ||
    (scope.shouldRestore && !scope.shouldRestore(query.queryKey))
  )
    return;

  const maxAgeMs = scope.maxAge
    ? parsedDurationToMilliseconds(scope.maxAge)
    : undefined;
  if (
    validatePersistedEntry(entry, scope.buster, maxAgeMs) !== 'valid' ||
    (scope.shouldRestoreData && !scope.shouldRestoreData(entry.data))
  ) {
    scope.store.remove(query.queryHash);
    return;
  }

  queryClient.setQueryData(query.queryKey, entry.data, {
    updatedAt: entry.dataUpdatedAt,
  });
}

/**
 * Drops account data and rebinds mounted observers to fresh queries. Resetting
 * a query would restore its old initialData; removing it alone would strand
 * observers on the retired query instead of delivering the next account's data.
 */
function clearQueryMemory(queryClient: QueryClient): void {
  const queryCache = queryClient.getQueryCache();
  notifyManager.batch(() => {
    for (const query of queryCache.getAll()) {
      const observers = query.observers.map((observer) => ({
        observer,
        options: {
          ...observer.options,
          initialData: undefined,
          initialDataUpdatedAt: undefined,
          placeholderData: undefined,
        },
      }));
      for (const { observer, options } of observers) {
        observer.setOptions(options);
      }
      // Observers also retain the last query with data for keepPreviousData.
      // Empty that retired object, and fence its in-flight response first.
      fireAndForget(query.cancel({ silent: true }), 'query-persistence');
      query.setState({
        data: undefined,
        dataUpdatedAt: 0,
        error: null,
        errorUpdatedAt: 0,
        status: 'pending',
        fetchStatus: 'idle',
      });
      queryCache.remove(query);

      let rebinding = true;
      for (const { observer, options } of observers) {
        observer.setOptions({
          ...options,
          enabled: (current) =>
            !rebinding &&
            (typeof options.enabled === 'function'
              ? options.enabled(current)
              : options.enabled !== false),
        });
      }
      // Restore the original enabled policy without starting a fetch while
      // auth is being cleared. The prior callback now resolves the same way.
      rebinding = false;
      for (const { observer, options } of observers) {
        observer.setOptions(options);
        observer.onQueryUpdate();
      }
    }
  });
  queryClient.getMutationCache().clear();
}

/**
 * Persists a query's current data to IDB when the query updates successfully.
 */
function handleUpdate(scope: PersistScope, query: Query): void {
  if (query.state.status !== 'success') return;
  scope.store.set({
    queryHash: query.queryHash,
    queryKey: query.queryKey,
    data: query.state.data,
    dataUpdatedAt: query.state.dataUpdatedAt,
    persistedAt: Date.now(),
    buster: scope.buster,
  });
}

/**
 * Sets up per-query persistence: individual queries are persisted to
 * and restored from IDB independently, rather than serializing the entire
 * query cache as one blob.
 *
 * - On 'added': restores cached data from IDB if the query has no fresh data.
 * - On 'updated': writes the query's successful data to IDB.
 * - On 'removed': deletes the query's entry from IDB.
 *
 * Restoration is shared with explicit callers; it never waits for the network.
 * Dispose stops listening and fences unfinished restores.
 */
export function setupQueryPersistence(
  params: Readonly<{
    queryClient: QueryClient;
    scopes: readonly PersistScope[];
  }>
): QueryPersistence {
  const { queryClient, scopes } = params;
  let restores = new WeakMap<Query, Promise<void>>();
  let generation = 0;
  let clearing = false;
  let disposed = false;

  const findScope = (queryKey: QueryKey) =>
    scopes.find((s) => s.shouldPersist(queryKey));

  async function restoreFromStore(query: Query, scope: PersistScope) {
    const capturedGeneration = generation;
    try {
      await handleRestore(
        queryClient,
        scope,
        query,
        () =>
          !disposed &&
          !clearing &&
          capturedGeneration === generation &&
          queryClient.getQueryCache().get(query.queryHash) === query
      );
    } catch {
      console.error('[query] IDB restore failed');
    }
  }

  const restore = (query: Query, scope: PersistScope): Promise<void> => {
    const existing = restores.get(query);
    if (existing) return existing;
    const pending = restoreFromStore(query, scope);
    restores.set(query, pending);
    return pending;
  };

  const flushAll = async () => {
    await Promise.all(scopes.map((scope) => scope.store.flush()));
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden')
      fireAndForget(flushAll(), 'query-persistence');
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const cacheUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
    const { type } = event;
    if (type !== 'added' && type !== 'updated' && type !== 'removed') return;

    const { query } = event;
    const scope = findScope(query.queryKey);
    if (!scope) return;

    if (disposed || clearing) return;

    if (type === 'added') {
      fireAndForget(restore(query, scope), 'query-persistence');
    } else if (type === 'updated') {
      handleUpdate(scope, query);
    } else {
      scope.store.remove(query.queryHash);
    }
  });

  return {
    restoreQuery(queryKey) {
      const scope = findScope(queryKey);
      if (disposed || clearing || !scope) return Promise.resolve();
      // Building a missing query emits `added`, starting the same restore that
      // an observer would start, without issuing a request or needing a queryFn.
      const query = queryClient
        .getQueryCache()
        .build(queryClient, { queryKey });
      return restore(query, scope);
    },
    async clear() {
      generation += 1;
      clearing = true;
      restores = new WeakMap();
      // Clear memory synchronously; removed-query events cannot race the reset.
      clearQueryMemory(queryClient);
      try {
        const results = await Promise.allSettled(
          scopes.map((scope) => scope.store.clear())
        );
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') {
          // Quarantine this session; logout rotates the disk namespace for restart.
          disposed = true;
          throw failed.reason;
        }
      } finally {
        clearing = false;
      }
    },
    flush: async () => {
      await Promise.all(
        scopes.map((scope) => scope.store.flush({ throwOnError: true }))
      );
    },
    dispose() {
      disposed = true;
      cacheUnsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
