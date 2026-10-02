import type { QueryFieldPatch } from '../protocol';

type QueryObject = Record<string, unknown>;
type Container = Record<string | number, unknown>;
const deltas = new WeakMap<
  object,
  { base: QueryObject; patches: readonly QueryFieldPatch[] }
>();
export const queryDelta = (data: object) => deltas.get(data);

/** Validate first, then copy just the changed paths. Earlier urql results stay immutable. */
export function applyQueryPatches(
  base: QueryObject,
  patches: readonly QueryFieldPatch[]
): QueryObject {
  for (const { path } of patches) {
    if (!path.length) throw new Error('query patch must target a field');
    let value: unknown = base;
    for (const part of path) {
      if (
        value === null ||
        typeof value !== 'object' ||
        (typeof part === 'number'
          ? !Number.isSafeInteger(part) || part < 0 || !Array.isArray(value)
          : ['__proto__', 'prototype', 'constructor'].includes(part)) ||
        !Object.hasOwn(value, part)
      )
        throw new Error('query patch has no matching base');
      value = (value as Container)[part];
    }
  }
  if (!patches.length) return base;
  const copies = new Map<object, Container>();
  const copy = (value: object): Container => {
    const previous = copies.get(value);
    if (previous) return previous;
    const next = (
      Array.isArray(value) ? [...value] : { ...value }
    ) as Container;
    copies.set(value, next);
    return next;
  };
  const next = copy(base);
  for (const { path, value } of patches) {
    let old = base as Container;
    let target = next;
    for (const part of path.slice(0, -1)) {
      const child = old[part] as object;
      target[part] = copy(child);
      old = child as Container;
      target = target[part] as Container;
    }
    target[path[path.length - 1]] = value;
  }
  // The current snapshot must not retain a chain of every earlier delta.
  deltas.delete(base);
  deltas.set(next, { base, patches });
  return next;
}
