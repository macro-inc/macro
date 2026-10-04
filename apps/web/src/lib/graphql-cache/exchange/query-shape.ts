import type { DocumentNode, SelectionSetNode } from 'graphql';
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

/** Preserve identified descendants even when an ambiguous ancestor is replaced. */
export function storeValue(
  value: unknown,
  shape?: QueryShape,
  previous?: unknown
): unknown {
  if (Array.isArray(value)) {
    const before = Array.isArray(previous) ? previous : [];
    const byKey = new Map<string, { items: unknown[]; index: number }>();
    for (const item of before) {
      const key =
        item && typeof item === 'object'
          ? Reflect.get(item, RECONCILE_KEY)
          : undefined;
      if (typeof key !== 'string') continue;
      const entries = byKey.get(key) ?? { items: [], index: 0 };
      entries.items.push(item);
      byKey.set(key, entries);
    }
    return value.map((item, index) => {
      const key =
        item && typeof item === 'object' ? entityKey(item, shape) : undefined;
      const entries = typeof key === 'string' ? byKey.get(key) : undefined;
      return storeValue(
        item,
        shape,
        entries ? entries.items[entries.index++] : before[index]
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
      storeValue(child, shape?.get(key)?.shape, before?.[key]),
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
