import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from '@tanstack/solid-query';

/** A query surface built on a TanStack query, such as a feature contract. */
type QueryLike = {
  readonly isPending: boolean;
  readonly isLoadingError?: boolean;
  readonly data: unknown;
};

export function queryReadyGate<T>(
  query: UseQueryResult<T> | UseInfiniteQueryResult<T>
): query is
  | (UseQueryResult<T, never> & { data: T })
  | (UseInfiniteQueryResult<T, never> & { data: T });
export function queryReadyGate<Q extends QueryLike>(
  query: Q
): query is Q & { readonly data: Exclude<Q['data'], undefined> };
export function queryReadyGate(query: QueryLike): boolean {
  // Disabled and paused queries are pending without being loading. Reading
  // their data still suspends, so check the broader initial-pending state.
  // A query that failed before it had data has none to read, and reading it
  // suspends again each time the query takes new options.
  if (query.isPending || query.isLoadingError) return false;
  return query.data !== undefined;
}
