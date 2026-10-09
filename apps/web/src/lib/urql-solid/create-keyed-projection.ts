import { keyArray } from '@solid-primitives/keyed';
import { type Accessor, createComputed, createMemo, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(snapshot) as T;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, snapshot(child)])
  ) as T;
}

function equalSnapshot(value: unknown, previous: unknown): boolean {
  if (Object.is(value, previous)) return true;
  if (Array.isArray(value))
    return (
      Array.isArray(previous) &&
      value.length === previous.length &&
      Object.keys(value).length === Object.keys(previous).length &&
      value.every((child, index) => equalSnapshot(child, previous[index]))
    );
  if (!isPlainObject(value) || !isPlainObject(previous)) return false;
  const entries = Object.entries(value);
  return (
    entries.length === Object.keys(previous).length &&
    entries.every(
      ([key, child]) =>
        Object.hasOwn(previous, key) && equalSnapshot(child, previous[key])
    )
  );
}

/** Tracks and reconciles each projected item independently, retaining keyed identity. */
export function createKeyedProjection<T, K, U>(
  items: Accessor<readonly T[]>,
  key: (item: T, index: number) => K,
  project: (item: T) => U
): Accessor<U[]> {
  const cells = keyArray(items, key, (item) => {
    let previous: U | undefined;
    const [state, setState] = createStore<{ value: U | undefined }>({
      value: undefined,
    });
    createComputed(() => {
      // Own the projection: reconciliation must never mutate a source query.
      const next = snapshot(project(item()));
      if (equalSnapshot(next, previous)) return;
      previous = next;
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
