import type { QueryKey } from '@tanstack/query-core';
import type { UseQueryResult } from '@tanstack/solid-query';
import { queryClient } from './client';

/**
 * Solid Query's `.data` getter calls `queryResource()` when the observer's
 * `state.data` is undefined, which throws into the nearest Suspense.
 * `placeholderData` is supposed to keep that field defined, but
 * `cancelQueries` / `invalidateQueries` / `setQueryData(undefined)` still
 * clear it — `suspense: false` is a no-op.
 *
 * Read the query cache instead. Track `dataUpdatedAt` so Solid still
 * re-runs when the cache changes.
 */
export function neverSuspendQuery<TData, TError>(
  query: UseQueryResult<TData, TError>,
  queryKey: QueryKey,
  fallback: TData
): UseQueryResult<TData, TError> {
  return new Proxy(query, {
    get(target, prop, receiver) {
      if (prop === 'data') {
        void target.dataUpdatedAt;
        return queryClient.getQueryData<TData>(queryKey) ?? fallback;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
