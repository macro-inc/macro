import type { QueryKey } from '@tanstack/solid-query';

// Query keys are immutable. Cache their text by identity so repeated scoped
// invalidations do not serialize the same filter AST on every cache walk.
const serializedKeys = new WeakMap<QueryKey, string>();

export function soupQueryKeyText(key: QueryKey): string {
  const cached = serializedKeys.get(key);
  if (cached !== undefined) return cached;
  const text = JSON.stringify(key);
  serializedKeys.set(key, text);
  return text;
}
