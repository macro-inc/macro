import type { Signal } from 'solid-js';

/**
 * Recursively unwraps SolidJS signals inside any object or array.
 * Also renames keys ending in "Signal" → base name (e.g. "layoutSignal" → "layout").
 */
export function unwrapSignals<T>(value: Record<string, any>): T {
  if (value == null) return value;

  // Detect signal accessor form: function with .value (rare, internal)
  if (typeof value === 'function' && 'value' in value) {
    return (value as any)();
  }

  // Detect signal tuple [getter, setter]
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === 'function')
  ) {
    // @ts-ignore
    return (value as Signal<unknown>)[0]();
  }

  // If it's an array of data, unwrap each item
  if (Array.isArray(value)) {
    return value.map(unwrapSignals) as T;
  }

  // If it's an object, unwrap each key
  if (typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      const unwrapped = unwrapSignals(val);
      const newKey = key.replace(/(Signal|Store)$/, '');
      result[newKey] = unwrapped;
    }
    return result as T;
  }

  // Primitive
  return value;
}
