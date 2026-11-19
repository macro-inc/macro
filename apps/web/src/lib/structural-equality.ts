/**
 * Deep equality check for two values.
 * Handles primitives, dates, arrays, objects, null, and undefined.
 * Arrays are compared by value (order matters).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  // Same reference or both primitives with same value
  if (a === b) return true;

  // Handle null/undefined
  if (a == null || b == null) return a === b;

  // Different types
  if (typeof a !== typeof b) return false;

  // Dates have no enumerable keys, so compare the instants they hold.
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }

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
