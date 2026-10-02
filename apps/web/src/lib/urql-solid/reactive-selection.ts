import type { CombinedError } from '@urql/core';
import { $PROXY, createComputed, createRoot, untrack } from 'solid-js';
import { toCombinedError } from './utils';

export type ReactiveSelection<T> = {
  current: () => { data: T | undefined; error: CombinedError | null };
  dispose: () => void;
};

/** Selectors also observe field updates that retain the query's object identity. */
export function createReactiveSelection<T>(
  select: () => T,
  notify: () => void
): ReactiveSelection<T> {
  let current: ReturnType<ReactiveSelection<T>['current']> = {
    data: undefined,
    error: null,
  };
  const dispose = createRoot((dispose) => {
    let initial = true;
    createComputed(() => {
      try {
        current = { data: select(), error: null };
      } catch (cause) {
        current = { data: current.data, error: toCombinedError(cause) };
      }
      if (!initial) untrack(notify);
      initial = false;
    });
    return dispose;
  });
  return { current: () => current, dispose };
}

/** Never reconcile into objects owned by another reactive query/projection. */
export function containsReactiveStore(
  value: unknown,
  seen = new Set<object>()
): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value))
    return false;
  if (Reflect.get(value, $PROXY) === value) return true;
  seen.add(value);
  return Object.values(value).some((child) =>
    containsReactiveStore(child, seen)
  );
}
