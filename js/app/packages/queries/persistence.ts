import {
  type PersistQueryClientOptions,
  persistQueryClient,
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
  getQueryCache: () => unknown;
  getMutationCache: () => unknown;
};

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

export function setupQueryPersistence(
  params: Readonly<{
    queryClient: QueryClientLike;
    buster: string;
    scopes: readonly PersistScope[];
  }>
) {
  for (const scope of params.scopes) {
    try {
      persistQueryClient({
        queryClient: params.queryClient as PersistQueryClient,
        persister: scope.persister,
        maxAge: scope.maxAgeMs,
        buster: params.buster,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' && scope.shouldDehydrateQuery(q),
        },
      });
    } catch {}
  }
}
