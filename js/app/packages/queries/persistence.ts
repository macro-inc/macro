import {
  type PersistQueryClientOptions,
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/solid-query-persist-client';
import type { Persister } from '@tanstack/solid-query-persist-client';
import type { QueryKey } from '@tanstack/query-core';

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

const CACHE_EVENT_TYPES = new Set(['added', 'removed', 'updated']);

export type PersistScope = Readonly<{
  persister: Persister;
  maxAgeMs: number;
  shouldDehydrateQuery: (query: Query) => boolean;
}>;

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

export function createPersistenceKey(
  name: string,
  version: number
): PersistenceKey {
  return `${name}-persist-v${version}`;
}

export function shouldPersistForScopeEvent(
  event: unknown,
  scope: PersistScope
): boolean {
  const queryEvent = event as QueryCacheEvent;
  const eventType = queryEvent.type;
  const query = queryEvent.query;

  if (!eventType || !CACHE_EVENT_TYPES.has(eventType) || !query) return false;
  if (query.state.status !== 'success') return false;
  return scope.shouldDehydrateQuery(query);
}

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

    void persistQueryClientRestore(persistOptions)
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
