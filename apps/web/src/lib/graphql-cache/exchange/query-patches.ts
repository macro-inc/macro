import type {
  QueryFieldPatch,
  QueryPatch,
  QuerySpliceOp,
  QuerySplicePatch,
} from '../protocol';

type QueryObject = Record<string, unknown>;
type Container = Record<string | number, unknown>;
type Path = readonly (string | number)[];

/** Ordered patches applied to `base`. `previous[i]` is the value a field patch
 * replaced, in the coordinates of the list edits that preceded it. */
export type QueryDelta = {
  base: QueryObject;
  patches: readonly QueryPatch[];
  previous: readonly unknown[];
};
const deltas = new WeakMap<object, QueryDelta>();
export const queryDelta = (data: object) => deltas.get(data);

export const isSplicePatch = (patch: QueryPatch): patch is QuerySplicePatch =>
  Object.hasOwn(patch, 'splice');

const isContainer = (value: unknown): value is object =>
  value !== null && typeof value === 'object';

/** The child at `part`, which must already exist in an object or list. */
function child(value: unknown, part: string | number): unknown {
  if (
    !isContainer(value) ||
    (Array.isArray(value)
      ? typeof part !== 'number' || !Number.isSafeInteger(part) || part < 0
      : typeof part !== 'string') ||
    !Object.hasOwn(value, part)
  )
    throw new Error('query patch has no matching base');
  return (value as Container)[part];
}

const isIndex = (value: unknown, length: number): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= length;

/** Applies one list edit to an owned copy, rejecting out-of-range indices. */
export function applySpliceOp(items: unknown[], op: QuerySpliceOp): void {
  if ('remove' in op) {
    if (!isIndex(op.remove, items.length - 1))
      throw new Error('query splice index out of range');
    items.splice(op.remove, 1);
  } else if ('insert' in op) {
    if (!isIndex(op.insert, items.length))
      throw new Error('query splice index out of range');
    items.splice(op.insert, 0, op.value);
  } else {
    if (
      !isIndex(op.move, items.length - 1) ||
      !isIndex(op.to, items.length - 1)
    )
      throw new Error('query splice index out of range');
    const [item] = items.splice(op.move, 1);
    items.splice(op.to, 0, item);
  }
}

/**
 * Rejects patches the engine never emits: a replacement overlapping another
 * replacement, or anything below a list before that list's splice. Patches
 * below a splice may follow it; they use the edited indices.
 */
function distinctPatches(patches: readonly QueryPatch[]): QueryPatch[] {
  type Node = {
    children: Map<string | number, Node>;
    patch?: QueryFieldPatch;
    spliced?: boolean;
  };
  const root: Node = { children: new Map() };
  const distinct: QueryPatch[] = [];
  for (const patch of patches) {
    const { path } = patch;
    if (!path.length) throw new Error('query patch must target a field');
    let node = root;
    for (const part of path) {
      if (node.patch) throw new Error('query patches overlap');
      let next = node.children.get(part);
      if (!next) {
        next = { children: new Map() };
        node.children.set(part, next);
      }
      node = next;
    }
    if (node.children.size || node.spliced)
      throw new Error('query patches overlap');
    if (isSplicePatch(patch)) {
      if (node.patch) throw new Error('query patches overlap');
      node.spliced = true;
      distinct.push(patch);
    } else if (node.patch) {
      if (JSON.stringify(node.patch.value) !== JSON.stringify(patch.value))
        throw new Error('query patches conflict');
    } else {
      node.patch = patch;
      distinct.push(patch);
    }
  }
  return distinct;
}

/** Apply patches in order, copying only changed paths. Earlier urql results
 * stay immutable, and an invalid patch leaves `base` untouched. */
export function applyQueryPatches(
  base: QueryObject,
  patches: readonly QueryPatch[]
): QueryObject {
  const distinct = distinctPatches(patches);
  if (!patches.length) return base;
  const owned = new Set<object>();
  const own = (value: object): Container => {
    if (owned.has(value)) return value as Container;
    const next = (
      Array.isArray(value) ? [...value] : { ...value }
    ) as Container;
    owned.add(next);
    return next;
  };
  const next = own(base);
  // An owned container at `path`, copying each container along the way.
  const ownedAt = (path: Path): Container => {
    let target = next;
    for (const part of path) {
      const value = child(target, part);
      if (!isContainer(value))
        throw new Error('query patch has no matching base');
      const copy = own(value);
      target[part] = copy;
      target = copy;
    }
    return target;
  };
  const previous: unknown[] = [];
  for (const patch of distinct) {
    if (isSplicePatch(patch)) {
      const items = ownedAt(patch.path);
      if (!Array.isArray(items)) throw new Error('query splice needs a list');
      for (const op of patch.splice) applySpliceOp(items, op);
      previous.push(undefined);
    } else {
      const parent = ownedAt(patch.path.slice(0, -1));
      const field = patch.path[patch.path.length - 1];
      previous.push(child(parent, field));
      parent[field] = patch.value;
    }
  }
  // The current snapshot must not retain a chain of every earlier delta.
  deltas.delete(base);
  deltas.set(next, { base, patches: distinct, previous });
  return next;
}
