import type {
  Query,
  QueryCacheNotifyEvent,
  QueryKey,
} from '@tanstack/query-core';
import type {
  PerQueryPersistence,
  PersistedQueryEntry,
} from './persistence/per-query-idb';
import {
  type ParsedDuration,
  parsedDurationToMilliseconds,
} from '@core/util/dateSearch/dateParser';

type PersistenceKey = `${string}-persist-v${number}`;

/** Builds a versioned persistence key for IDB database naming. */
export function createPersistenceKey(
  name: string,
  version: number
): PersistenceKey {
  return `${name}-persist-v${version}`;
}

export type PersistScope = Readonly<{
  store: PerQueryPersistence;
  maxAge: ParsedDuration;
  buster: string;
  shouldPersist: (queryKey: QueryKey) => boolean;
}>;

type QueryClientLike = {
  getQueryCache: () => {
    subscribe: (listener: (event: QueryCacheNotifyEvent) => void) => () => void;
  };
  getQueryState: (
    queryKey: QueryKey
  ) => { status: string; data: unknown; dataUpdatedAt: number } | undefined;
  setQueryData: (
    queryKey: QueryKey,
    data: unknown,
    options?: { updatedAt?: number }
  ) => void;
};

/**
 * Validates a persisted entry against the current cache-buster and max age.
 * Returns 'valid' if the entry can be restored, or a reason string
 * explaining why it should be discarded.
 */
function validatePersistedEntry(
  entry: PersistedQueryEntry,
  buster: string,
  maxAgeMs: number
): 'valid' | 'buster_mismatch' | 'expired' {
  if (entry.buster !== buster) return 'buster_mismatch';
  if (Date.now() - entry.dataUpdatedAt > maxAgeMs) return 'expired';
  return 'valid';
}

/**
 * Attempts to restore a query's data from IDB when the query is first added
 * to the cache. Validates the entry and guards against race conditions where
 * a fresh fetch resolves before the IDB read completes.
 */
async function handleRestore(
  queryClient: QueryClientLike,
  scope: PersistScope,
  query: Query
): Promise<void> {
  const state = queryClient.getQueryState(query.queryKey);
  if (state && state.status === 'success') return;

  let entry: PersistedQueryEntry | undefined;
  try {
    entry = await scope.store.get(query.queryHash);
  } catch {
    console.error('[query] IDB persistence read failed');
    return;
  }

  if (!entry) return;

  const maxAgeMs = parsedDurationToMilliseconds(scope.maxAge);
  if (validatePersistedEntry(entry, scope.buster, maxAgeMs) !== 'valid') {
    scope.store.remove(query.queryHash);
    return;
  }

  const current = queryClient.getQueryState(query.queryKey);
  if (current && current.status === 'success') return;

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
 * Returns an unsubscribe function to stop listening.
 */
export function setupQueryPersistence(
  params: Readonly<{
    queryClient: QueryClientLike;
    scopes: readonly PersistScope[];
  }>
): () => void {
  const { queryClient, scopes } = params;

  const findScope = (queryKey: QueryKey) =>
    scopes.find((s) => s.shouldPersist(queryKey));

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
      handleRestore(queryClient, scope, query).catch((err) => {
        console.error('[query] IDB restore failed', err);
      });
    } else if (type === 'updated') {
      handleUpdate(scope, query);
    } else {
      scope.store.remove(query.queryHash);
    }
  });

  return () => {
    cacheUnsubscribe();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
