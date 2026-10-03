import deepEqual from 'fast-deep-equal';
import { type Accessor, createMemo, getOwner, runWithOwner } from 'solid-js';

/**
 * A read-only record with one memo per property, so a reader re-runs only
 * when the property it read changes.
 */
export function createMemoRecord<T extends object>(read: () => T): T {
  const owner = getOwner();
  const memos = new Map<PropertyKey, Accessor<unknown>>();

  const createPropertyMemo = (key: PropertyKey) =>
    runWithOwner(owner, () =>
      createMemo(() => read()[key as keyof T], undefined, {
        equals: deepEqual,
      })
    )!;

  const value = (key: PropertyKey) => {
    const existing = memos.get(key);
    if (existing) return existing();

    const memo = createPropertyMemo(key);
    memos.set(key, memo);

    return memo();
  };

  return new Proxy({} as T, {
    get: (_target, key) => value(key),
    has: (_target, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, key) => {
      const present = key in read();
      if (!present) return;

      return { enumerable: true, configurable: true, value: value(key) };
    },
  });
}
