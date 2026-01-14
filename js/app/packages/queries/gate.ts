import type {
  UseQueryResult,
  UseInfiniteQueryResult,
} from '@tanstack/solid-query';

export function queryReadyGate<T>(
  query: UseQueryResult<T> | UseInfiniteQueryResult<T>
): query is
  | (UseQueryResult<T, never> & { data: T })
  | (UseInfiniteQueryResult<T, never> & { data: T }) {
  return !query.isLoading && query.data !== undefined;
}
