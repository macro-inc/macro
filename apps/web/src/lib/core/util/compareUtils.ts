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

function uniqueByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
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

/**
 * Deep equality check for two values.
 * Handles primitives, arrays, objects, null, and undefined.
 * Arrays are compared by value (order matters).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  // Same reference or both primitives with same value
  if (a === b) return true;

  // Handle null/undefined
  if (a == null || b == null) return a === b;

  // Different types
  if (typeof a !== typeof b) return false;

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  // One is array, one is not
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  // Objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);

    // Get all unique keys from both objects
    const allKeys = new Set([...aKeys, ...bKeys]);

    for (const key of allKeys) {
      const aVal = (a as Record<string, unknown>)[key];
      const bVal = (b as Record<string, unknown>)[key];

      // Treat undefined and missing keys as equivalent
      if (aVal === undefined && bVal === undefined) continue;

      if (!deepEqual(aVal, bVal)) return false;
    }

    return true;
  }

  // Primitives that aren't equal (already handled by ===)
  return false;
}
