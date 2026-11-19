export { deepEqual } from '@app/lib/structural-equality';

export function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a.values()) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function arrayEquals<T>(a: readonly T[], b: readonly T[]): boolean;
export function arrayEquals<T>(a: ArrayLike<T>, b: ArrayLike<T>): boolean;
export function arrayEquals(
  a: ArrayLike<unknown>,
  b: ArrayLike<unknown>
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function _mergeByKey<T extends Record<string, any>, K extends keyof T>(
  key: K,
  ...lists: T[][]
): T[] {
  const map = new Map<T[K], T>();
  for (const list of lists) {
    for (const item of list) {
      const id = item[key];
      if (!map.has(id)) map.set(id, item);
    }
  }
  return Array.from(map.values());
}

function _mapFromListsByKey<T extends Record<string, any>>(
  extractor: (item: T) => string,
  ...lists: T[][]
): Map<string, T> {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      const id = extractor(item);
      if (!map.has(id)) map.set(id, item);
    }
  }
  return map;
}

/** First-occurrence-wins dedup by a string key, preserving input order. */
export function uniqueByKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function _uniqueByKeySorted<T>(
  items: readonly T[],
  keyOf: (item: T) => string
): T[] {
  return uniqueByKey(items, keyOf).toSorted((a, b) =>
    keyOf(a).localeCompare(keyOf(b))
  );
}
