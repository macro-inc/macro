import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from '@tanstack/solid-query';

export function queryReadyGate<T>(
  query: UseQueryResult<T> | UseInfiniteQueryResult<T>
): query is
  | (UseQueryResult<T, never> & { data: T })
  | (UseInfiniteQueryResult<T, never> & { data: T }) {
  // Disabled and paused queries can be pending without being loading. Reading
  // their data subscribes the caller to a resource that can suspend on every
  // observer update, even though there is no request to wait for.
  return query.isSuccess && query.data !== undefined;
}
