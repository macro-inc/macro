import type { DocumentNode, SelectionSetNode } from 'graphql';
import { $PROXY } from 'solid-js';
import { reconcile } from 'solid-js/store';

// GraphQL response names cannot contain NUL. Keep store-only identity metadata
// non-enumerable so it never becomes part of a query result or JSON snapshot.
export const RECONCILE_KEY = '\0cache-entity';
type Field = { names: Set<string>; shape: QueryShape };
export type QueryShape = Map<string, Field>;

export function queryShape(document: DocumentNode): QueryShape {
  const fragments = new Map(
    document.definitions.flatMap((definition) =>
      definition.kind === 'FragmentDefinition'
        ? [[definition.name.value, definition.selectionSet] as const]
        : []
    )
  );
  const collect = (
    selection: SelectionSetNode,
    shape: QueryShape,
    visiting: Set<string>
  ) => {
    for (const node of selection.selections) {
      if (node.kind === 'Field') {
        const key = node.alias?.value ?? node.name.value;
        let field = shape.get(key);
        if (!field) {
          field = { names: new Set(), shape: new Map() };
          shape.set(key, field);
        }
        field.names.add(node.name.value);
        if (node.selectionSet)
          collect(node.selectionSet, field.shape, visiting);
      } else if (node.kind === 'InlineFragment') {
        collect(node.selectionSet, shape, visiting);
      } else {
        const name = node.name.value;
        const fragment = fragments.get(name);
        if (fragment && !visiting.has(name))
          collect(fragment, shape, new Set([...visiting, name]));
      }
    }
  };
  const shape: QueryShape = new Map();
  for (const definition of document.definitions) {
    if (definition.kind === 'OperationDefinition')
      collect(definition.selectionSet, shape, new Set());
  }
  return shape;
}

export function shapeAtPath(
  shape: QueryShape | undefined,
  path: readonly (string | number)[]
): QueryShape | undefined {
  for (const part of path)
    if (typeof part === 'string') shape = shape?.get(part)?.shape;
  return shape;
}

export function isIdentityPath(
  shape: QueryShape | undefined,
  path: readonly (string | number)[]
): boolean {
  const last = path.at(-1);
  if (typeof last !== 'string') return false;
  const parent = shapeAtPath(shape, path.slice(0, -1));
  return parent
    ? [...(parent.get(last)?.names ?? [])].some(
        (name) => name === 'id' || name === '__typename'
      )
    : last === 'id' || last === '__typename';
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Clone selected data for store ownership and attach alias-aware entity keys. */
function entityKey(source: Record<string, unknown>, shape?: QueryShape) {
  const selected = (name: string): unknown => {
    if (!shape) return source[name];
    for (const [key, field] of shape) {
      // Mutually exclusive fragments can reuse an alias for different fields.
      // An ambiguous alias must never identify an unrelated object.
      if (
        field.names.size === 1 &&
        field.names.has(name) &&
        Object.hasOwn(source, key)
      )
        return source[key];
    }
    return undefined;
  };
  const id = selected('id');
  if (typeof id === 'string' || typeof id === 'number') {
    const typename = selected('__typename');
    // IDs are only unique within a concrete GraphQL type. Without its typename,
    // replace this object rather than retarget a retained proxy to another type.
    return typeof typename === 'string'
      ? JSON.stringify([typename, id])
      : Symbol('unidentified-entity');
  }
}

/** Compare immutable selected values before reconciliation mutates owned stores. */
export function equalQueryValue(value: unknown, previous: unknown): boolean {
  if (Object.is(value, previous)) return true;
  if (
    value === null ||
    previous === null ||
    typeof value !== 'object' ||
    typeof previous !== 'object' ||
    Array.isArray(value) !== Array.isArray(previous)
  )
    return false;
  if (!Array.isArray(value)) {
    for (const candidate of [value, previous]) {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) return false;
    }
  }
  const keys = Object.keys(value);
  return (
    keys.length === Object.keys(previous).length &&
    keys.every(
      (key) =>
        Object.hasOwn(previous, key) &&
        equalQueryValue(Reflect.get(value, key), Reflect.get(previous, key))
    )
  );
}

/** Preserve identified descendants even when an ambiguous ancestor is replaced. */
export function storeValue(
  value: unknown,
  shape?: QueryShape,
  previous?: unknown,
  previousSnapshot?: unknown
): unknown {
  // Untouched, untyped entities must not receive fresh identity symbols on
  // structural reads. Reuse only when their entire selected value is unchanged.
  if (
    value !== null &&
    typeof value === 'object' &&
    previous !== null &&
    typeof previous === 'object' &&
    equalQueryValue(value, previousSnapshot)
  ) {
    return Reflect.get(previous, $PROXY) ?? previous;
  }
  if (Array.isArray(value)) {
    const before = Array.isArray(previous) ? previous : [];
    const snapshot = Array.isArray(previousSnapshot) ? previousSnapshot : [];
    const byKey = new Map<
      string,
      { items: { value: unknown; snapshot: unknown }[]; index: number }
    >();
    for (const [index, item] of before.entries()) {
      const key =
        item && typeof item === 'object'
          ? Reflect.get(item, RECONCILE_KEY)
          : undefined;
      if (typeof key !== 'string') continue;
      const entries = byKey.get(key) ?? { items: [], index: 0 };
      entries.items.push({ value: item, snapshot: snapshot[index] });
      byKey.set(key, entries);
    }
    return value.map((item, index) => {
      const key =
        item && typeof item === 'object' ? entityKey(item, shape) : undefined;
      const entries = typeof key === 'string' ? byKey.get(key) : undefined;
      const matched = entries?.items[entries.index++];
      // A reordered keyed row may already have mutated the positional object.
      // New identities cannot borrow its children or its immutable snapshot.
      const positional = before[index];
      const usePosition =
        typeof key !== 'string' &&
        !(
          positional &&
          typeof positional === 'object' &&
          typeof Reflect.get(positional, RECONCILE_KEY) === 'string'
        );
      return storeValue(
        item,
        shape,
        matched?.value ?? (usePosition ? positional : undefined),
        matched?.snapshot ?? (usePosition ? snapshot[index] : undefined)
      );
    });
  }
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const before =
    previous !== null &&
    typeof previous === 'object' &&
    !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : undefined;
  const copy = Object.fromEntries(
    Object.entries(source).map(([key, child]) => [
      key,
      storeValue(
        child,
        shape?.get(key)?.shape,
        before?.[key],
        previousSnapshot !== null && typeof previousSnapshot === 'object'
          ? Reflect.get(previousSnapshot, key)
          : undefined
      ),
    ])
  );
  const key = entityKey(source, shape);
  if (key !== undefined)
    Object.defineProperty(copy, RECONCILE_KEY, {
      value: key,
      configurable: true,
    });
  if (typeof key === 'string' && before?.[RECONCILE_KEY] === key)
    return reconcile(copy, { key: RECONCILE_KEY, merge: false })(before);
  return copy;
}

// A shared row stays the previous value of the next result, so its key is read
// once per object and shape rather than once per result.
const sharedKeys = new WeakMap<
  object,
  { shape: QueryShape | undefined; key: string }
>();
function listItemKey(item: unknown, shape?: QueryShape): string | undefined {
  if (!isObject(item)) return undefined;
  const known = sharedKeys.get(item);
  if (known !== undefined && known.shape === shape) return known.key;
  const key = entityKey(item, shape);
  if (typeof key !== 'string') return undefined;
  sharedKeys.set(item, { shape, key });
  return key;
}

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * `next`, taking from `previous` every subtree whose selected content is
 * unchanged, so a reader can compare rows by identity across results. Keyed
 * list items match by entity key (an insert, removal or reorder keeps every
 * other row), others by position. `previousSource` is the result `previous`
 * was shared from: it mirrors `previous` exactly, so a subtree `next` reuses
 * from it (a patched result keeps every path it did not touch) takes its
 * shared value without a walk. It allocates only along changes.
 */
export function shareQueryValue(
  next: unknown,
  previous: unknown,
  shape?: QueryShape,
  previousSource?: unknown
): unknown {
  if (Object.is(next, previous) || Object.is(next, previousSource))
    return previous;
  if (
    next === null ||
    typeof next !== 'object' ||
    previous === null ||
    typeof previous !== 'object' ||
    Array.isArray(next) !== Array.isArray(previous) ||
    (!Array.isArray(next) && !(isPlainObject(next) && isPlainObject(previous)))
  )
    return next;
  if (Array.isArray(next)) {
    const before = previous as unknown[];
    const sources = Array.isArray(previousSource)
      ? (previousSource as unknown[])
      : undefined;
    // A patched list keeps most items in place: match those by position and
    // key the rest only when one is not.
    let byKey: Map<string, number[]> | undefined;
    const keyed = () => {
      if (byKey) return byKey;
      byKey = new Map();
      for (const [index, item] of before.entries()) {
        const key = listItemKey(item, shape);
        if (key === undefined) continue;
        const matches = byKey.get(key);
        if (matches) matches.push(index);
        else byKey.set(key, [index]);
      }
      return byKey;
    };
    const taken = new Uint8Array(before.length);
    let same = next.length === before.length;
    const shared = next.map((item, index) => {
      if (
        sources &&
        index < sources.length &&
        Object.is(item, sources[index])
      ) {
        taken[index] = 1;
        return before[index];
      }
      const key = listItemKey(item, shape);
      let match: number | undefined = index;
      if (key !== undefined) {
        const matches = keyed().get(key);
        while (matches?.length && taken[matches[0]]) matches.shift();
        match = matches?.shift();
      }
      if (match !== undefined && match < before.length) taken[match] = 1;
      const value =
        match === undefined
          ? item
          : shareQueryValue(item, before[match], shape, sources?.[match]);
      if (value !== before[index]) same = false;
      return value;
    });
    return same ? before : shared;
  }
  const source = next as Record<string, unknown>;
  const base = previous as Record<string, unknown>;
  const baseSource = isObject(previousSource)
    ? (previousSource as Record<string, unknown>)
    : undefined;
  const keys = Object.keys(source);
  let same = keys.length === Object.keys(base).length;
  const shared: Record<string, unknown> = {};
  for (const key of keys) {
    const had = Object.hasOwn(base, key);
    const value = shareQueryValue(
      source[key],
      had ? base[key] : undefined,
      shape?.get(key)?.shape,
      had ? baseSource?.[key] : undefined
    );
    if (!had || value !== base[key]) same = false;
    shared[key] = value;
  }
  return same ? base : shared;
}

/**
 * `previous` with each patch shared in at its path: each container along a
 * patch path is copied at most once per call, so the patches cost their
 * paths, not the result times the patch count.
 * `previousSource` is the result `previous` mirrors; it speeds up a subtree
 * only where no earlier patch in the list has changed `previous`. Returns
 * undefined when a path leaves `previous`, for a full share instead.
 */
export function shareQueryPatches(
  previous: unknown,
  previousSource: unknown,
  patches: readonly {
    path: readonly (string | number)[];
    value: unknown;
  }[],
  shape?: QueryShape
): unknown {
  let shared = previous;
  // Containers this call copied: later patches write into them in place.
  const fresh = new WeakSet<object>();
  for (const { path, value } of patches) {
    const next = shareAtPath(
      shared,
      previous,
      previousSource,
      path,
      0,
      value,
      shape,
      fresh
    );
    if (next === undefined) return undefined;
    shared = next.value;
  }
  return shared;
}

function shareAtPath(
  shared: unknown,
  original: unknown,
  source: unknown,
  path: readonly (string | number)[],
  index: number,
  value: unknown,
  shape: QueryShape | undefined,
  fresh: WeakSet<object>
): { value: unknown } | undefined {
  if (index === path.length)
    return {
      value: shareQueryValue(
        value,
        shared,
        shape,
        shared === original ? source : undefined
      ),
    };
  if (shared === null || typeof shared !== 'object') return undefined;
  const part = path[index];
  const container = shared as Record<string | number, unknown>;
  if (!Object.hasOwn(container, part)) return undefined;
  const child = shareAtPath(
    container[part],
    // The node `previous` has on this path: the source hint holds only where
    // the shared node is still that one.
    original !== null && typeof original === 'object'
      ? (original as Record<string | number, unknown>)[part]
      : undefined,
    source !== null && typeof source === 'object'
      ? (source as Record<string | number, unknown>)[part]
      : undefined,
    path,
    index + 1,
    value,
    typeof part === 'string' ? shape?.get(part)?.shape : shape,
    fresh
  );
  if (child === undefined) return undefined;
  if (Object.is(child.value, container[part])) return { value: shared };
  if (fresh.has(container)) {
    container[part] = child.value;
    return { value: shared };
  }
  const copy = (
    Array.isArray(shared) ? shared.slice() : { ...container }
  ) as Record<string | number, unknown>;
  copy[part] = child.value;
  fresh.add(copy);
  return { value: copy };
}
