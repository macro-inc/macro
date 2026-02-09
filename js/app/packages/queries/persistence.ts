import {
  type PersistQueryClientOptions,
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/solid-query-persist-client';
import type { Persister } from '@tanstack/solid-query-persist-client';
import type { QueryKey } from '@tanstack/query-core';
import type {
  PerQueryIDBStore,
  PersistedQueryEntry,
} from './persistence/per-query-idb';

type Query = NonNullable<
  PersistQueryClientOptions['dehydrateOptions']
>['shouldDehydrateQuery'] extends ((query: infer Q) => boolean) | undefined
  ? Q
  : never;

type PersistQueryClient = PersistQueryClientOptions['queryClient'];

/**
 * Structurally compatible QueryClient type. Accepts any QueryClient instance
 * to work around version mismatches in @tanstack packages.
 */
type QueryClientLike = {
  getQueryCache: () => QueryCacheLike;
};

type QueryCacheLike = {
  subscribe: (listener: (event: unknown) => void) => () => void;
};

type QueryCacheEvent = {
  type?: string;
  query?: Query;
};

/** Cache event types that trigger persistence (shared across both strategies). */
const PERSIST_EVENT_TYPES = new Set(['added', 'removed', 'updated']);

/** Checks if a query key starts with the given prefix tuple. */
export function queryKeyHasPrefix(
  key: QueryKey,
  prefix: readonly unknown[]
): boolean {
  if (!Array.isArray(key)) return false;
  if (prefix.length > key.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (key[i] !== prefix[i]) return false;
  }
  return true;
}

type PersistenceKey = `${string}-persist-v${number}`;

/** Builds a versioned persistence key for IDB database naming. */
export function createPersistenceKey(
  name: string,
  version: number
): PersistenceKey {
  return `${name}-persist-v${version}`;
}

export type PersistScope = Readonly<{
  persister: Persister;
  maxAgeMs: number;
  shouldDehydrateQuery: (query: Query) => boolean;
}>;

/**
 * Determines whether a query cache event should trigger a bulk persist
 * for the given scope. Returns true only for relevant event types
 * on successfully-fetched queries matching the scope's predicate.
 */
export function shouldPersistForScopeEvent(
  event: unknown,
  scope: PersistScope
): boolean {
  const queryEvent = event as QueryCacheEvent;
  const eventType = queryEvent.type;
  const query = queryEvent.query;

  if (!eventType || !PERSIST_EVENT_TYPES.has(eventType) || !query) return false;
  if (query.state.status !== 'success') return false;
  return scope.shouldDehydrateQuery(query);
}

/**
 * Sets up bulk query persistence: restores cached state on startup,
 * then subscribes to query cache events to persist on each relevant change.
 *
 * Each scope gets its own persister, filter predicate, and max age.
 */
export function setupQueryPersistence(
  params: Readonly<{
    queryClient: QueryClientLike;
    buster: string;
    scopes: readonly PersistScope[];
  }>
) {
  for (const scope of params.scopes) {
    const persistOptions = {
      queryClient: params.queryClient as PersistQueryClient,
      persister: scope.persister,
      maxAge: scope.maxAgeMs,
      buster: params.buster,
      dehydrateOptions: {
        shouldDehydrateQuery: (q: Query) =>
          q.state.status === 'success' && scope.shouldDehydrateQuery(q),
      },
    } satisfies PersistQueryClientOptions;

    persistQueryClientRestore(persistOptions)
      .then(() => {
        params.queryClient.getQueryCache().subscribe((event) => {
          if (!shouldPersistForScopeEvent(event, scope)) return;
          void persistQueryClientSave(persistOptions);
        });
      })
      .catch(() => {
        // Keep startup resilient if persistence restore fails.
      });
  }
}

export type LazyPersistScope = Readonly<{
  store: PerQueryIDBStore;
  maxAgeMs: number;
  buster: string;
  shouldPersist: (queryKey: QueryKey) => boolean;
}>;

type LazyQueryClientLike = {
  getQueryCache: () => QueryCacheLike;
  getQueryState: (
    queryKey: QueryKey
  ) => { status: string; data: unknown; dataUpdatedAt: number } | undefined;
  setQueryData: (
    queryKey: QueryKey,
    data: unknown,
    options?: { updatedAt?: number }
  ) => void;
};

type LazyCacheEvent = {
  type?: string;
  query?: {
    queryHash: string;
    queryKey: QueryKey;
    state: { status: string; data: unknown; dataUpdatedAt: number };
  };
};

/**
 * Validates a persisted entry against the current cache-buster and max age.
 * Returns 'valid' if the entry can be restored, or a reason string
 * explaining why it should be discarded.
 */
export function validatePersistedEntry(
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
function handleLazyRestore(
  queryClient: LazyQueryClientLike,
  scope: LazyPersistScope,
  queryHash: string,
  queryKey: QueryKey
): void {
  const state = queryClient.getQueryState(queryKey);
  if (state && state.status === 'success') return;

  scope.store
    .get(queryHash)
    .then((entry) => {
      if (!entry) return;

      if (
        validatePersistedEntry(entry, scope.buster, scope.maxAgeMs) !== 'valid'
      ) {
        scope.store.remove(queryHash);
        return;
      }

      const current = queryClient.getQueryState(queryKey);
      if (current && current.status === 'success') return;

      queryClient.setQueryData(queryKey, entry.data, {
        updatedAt: entry.dataUpdatedAt,
      });
    })
    .catch(() => {
      console.error('[query] IDB persistence read failed');
    });
}

/**
 * Persists a query's current data to IDB when the query updates successfully.
 */
function handleLazyUpdate(
  scope: LazyPersistScope,
  query: NonNullable<LazyCacheEvent['query']>
): void {
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
 * Sets up lazy per-query persistence: individual queries are persisted to
 * and restored from IDB independently, rather than serializing the entire
 * query cache as one blob.
 *
 * - On 'added': restores cached data from IDB if the query has no fresh data.
 * - On 'updated': writes the query's successful data to IDB.
 * - On 'removed': deletes the query's entry from IDB.
 *
 * Returns an unsubscribe function to stop listening.
 */
export function setupLazyQueryPersistence(
  params: Readonly<{
    queryClient: LazyQueryClientLike;
    scopes: readonly LazyPersistScope[];
  }>
): () => void {
  const { queryClient, scopes } = params;

  const findScope = (queryKey: QueryKey) =>
    scopes.find((s) => s.shouldPersist(queryKey));

  const unsubscribe = queryClient.getQueryCache().subscribe((raw) => {
    const event = raw as LazyCacheEvent;
    const { type, query } = event;
    if (!type || !PERSIST_EVENT_TYPES.has(type) || !query) return;

    const scope = findScope(query.queryKey);
    if (!scope) return;

    const { queryHash, queryKey } = query;

    if (type === 'added') {
      handleLazyRestore(queryClient, scope, queryHash, queryKey);
    } else if (type === 'updated') {
      handleLazyUpdate(scope, query);
    } else if (type === 'removed') {
      scope.store.remove(queryHash);
    }
  });

  return unsubscribe;
}
