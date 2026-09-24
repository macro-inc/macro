import {
  type ParsedDuration,
  parsedDurationToMilliseconds,
} from '@core/util/dateSearch/dateParser';
import type { Query, QueryClient, QueryKey } from '@tanstack/query-core';
import type {
  PerQueryPersistence,
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
  store: PerQueryPersistence;
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
  const restores = new WeakMap<Query, Promise<void>>();
  let disposed = false;

  const findScope = (queryKey: QueryKey) =>
    scopes.find((s) => s.shouldPersist(queryKey));

  async function restoreFromStore(query: Query, scope: PersistScope) {
    try {
      await handleRestore(
        queryClient,
        scope,
        query,
        () =>
          !disposed &&
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

  const flushAll = () => {
    for (const scope of scopes) {
      void scope.store.flush();
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flushAll();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const cacheUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
    const { type } = event;
    if (type !== 'added' && type !== 'updated' && type !== 'removed') return;

    const { query } = event;
    const scope = findScope(query.queryKey);
    if (!scope) return;

    if (type === 'added') {
      void restore(query, scope);
    } else if (type === 'updated') {
      handleUpdate(scope, query);
    } else {
      scope.store.remove(query.queryHash);
    }
  });

  return {
    restoreQuery(queryKey) {
      const scope = findScope(queryKey);
      if (disposed || !scope) return Promise.resolve();
      // Building a missing query emits `added`, starting the same restore that
      // an observer would start, without issuing a request or needing a queryFn.
      const query = queryClient
        .getQueryCache()
        .build(queryClient, { queryKey });
      return restore(query, scope);
    },
    dispose() {
      disposed = true;
      cacheUnsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
