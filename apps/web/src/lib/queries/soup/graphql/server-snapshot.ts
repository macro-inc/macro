import { $PROXY } from 'solid-js';
import { querySnapshot } from '../../../graphql-cache/exchange/live-query';
import { shareQueryValue } from '../../../graphql-cache/exchange/query-shape';

function copy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copy);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, copy(child)])
  );
}

/**
 * Server Soup data as an immutable value. A normalized-cache result has a
 * snapshot that keeps each unchanged row's object across results. A result
 * held in urql-solid's own store (the uncached client) is copied, reading
 * every field, so a change in place reruns the reader; `shareServerRows` then
 * gives back the previous object of every row the change left alone.
 */
export function serverSnapshot<T>(value: T): T {
  const snapshot = querySnapshot(value);
  if (
    snapshot !== value ||
    value === null ||
    typeof value !== 'object' ||
    Reflect.get(value, $PROXY) !== value
  )
    return snapshot;
  return copy(value) as T;
}

/** `next`, keeping each row of `previous` whose content is unchanged. */
export function shareServerRows<T>(next: T, previous: T | undefined): T {
  return shareQueryValue(next, previous) as T;
}
