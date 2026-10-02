import { keyArray } from '@solid-primitives/keyed';
import { type Accessor, createComputed, createMemo, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(snapshot) as T;
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, value]) => [key, snapshot(value)])
  ) as T;
}

/** Tracks and reconciles each projected item independently, retaining keyed identity. */
export function createKeyedProjection<T, K, U>(
  items: Accessor<readonly T[]>,
  key: (item: T, index: number) => K,
  project: (item: T) => U
): Accessor<U[]> {
  const cells = keyArray(items, key, (item) => {
    const [state, setState] = createStore<{ value: U | undefined }>({
      value: undefined,
    });
    createComputed(() => {
      // Own the projection: reconciliation must never mutate a source query.
      const next = snapshot(project(item()));
      untrack(() =>
        setState('value', reconcile(next, { key: 'id', merge: true }))
      );
    });
    return () => state.value as U;
  });
  return createMemo(() => cells().map((cell) => cell()), undefined, {
    equals: (previous, next) =>
      previous.length === next.length &&
      previous.every((value, index) => value === next[index]),
  });
}
