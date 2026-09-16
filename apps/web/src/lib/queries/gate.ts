import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from '@tanstack/solid-query';

export function queryReadyGate<T>(
  query: UseQueryResult<T> | UseInfiniteQueryResult<T>
): query is
  | (UseQueryResult<T, never> & { data: T })
  | (UseInfiniteQueryResult<T, never> & { data: T }) {
  // Disabled and paused queries are pending without being loading. Reading
  // their data still touches Solid's resource and can suspend the caller.
  return !query.isPending && query.data !== undefined;
}
