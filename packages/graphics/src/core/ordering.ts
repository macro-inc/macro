import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import type { GraphicsDocument } from './model';

/** Persisted, case-sensitive fractional index. Allocate through these helpers. */
export type SortKey = string;
export type LayerPosition =
  | 'back'
  | 'front'
  | Readonly<{ before: string }>
  | Readonly<{ after: string }>;

export function isSortKey(value: unknown): value is SortKey {
  if (typeof value !== 'string' || !/^[A-Za-z][0-9A-Za-z]+$/.test(value))
    return false;
  try {
    generateKeyBetween(value, null);
    return true;
  } catch {
    return false;
  }
}

export function sortKeysBetween(
  lower: SortKey | null,
  upper: SortKey | null,
  count: number
): readonly SortKey[] {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    (lower !== null && !isSortKey(lower)) ||
    (upper !== null && !isSortKey(upper)) ||
    (lower !== null && upper !== null && lower >= upper)
  )
    throw new Error('Invalid sort key interval');
  return generateNKeysBetween(lower, upper, count);
}

const childIndexes = new WeakMap<
  GraphicsDocument['items'],
  ReadonlyMap<string, readonly string[]>
>();
const noChildren: readonly string[] = Object.freeze([]);

export function children(
  doc: GraphicsDocument,
  parentId = doc.rootId
): readonly string[] {
  // Only immutable snapshots can be indexed. Mutable editor/host projections
  // must continue reading their nodes so changes and reactive dependencies survive.
  let index = childIndexes.get(doc.items);
  if (!index) {
    const groups = new Map<string, string[]>();
    for (const node of Object.values(doc.items)) {
      if (node.type === 'surface') continue;
      let siblings = groups.get(node.placement.parentId);
      if (!siblings) {
        siblings = [];
        groups.set(node.placement.parentId, siblings);
      }
      siblings.push(node.id);
    }
    for (const siblings of groups.values()) {
      siblings.sort((a, b) => {
        const left = nodeSortKey(doc, a)!,
          right = nodeSortKey(doc, b)!;
        return left < right
          ? -1
          : left > right
            ? 1
            : a < b
              ? -1
              : a > b
                ? 1
                : 0;
      });
      Object.freeze(siblings);
    }
    index = groups;
    if (Object.isFrozen(doc.items)) childIndexes.set(doc.items, index);
  }
  return index.get(parentId) ?? noChildren;
}

export function nodeSortKey(
  doc: GraphicsDocument,
  id?: string
): SortKey | null {
  const node = id === undefined ? undefined : doc.items[id];
  return node && node.type !== 'surface' ? node.placement.sortKey : null;
}

export function insertionIndex(
  siblings: readonly string[],
  position: LayerPosition
): number {
  if (position === 'front') return siblings.length;
  if (position === 'back') return 0;
  const index = siblings.indexOf(
    'before' in position ? position.before : position.after
  );
  if (index < 0) throw new Error('Layer anchor must be an unselected sibling');
  return index + ('after' in position ? 1 : 0);
}

export function keysAt(
  doc: GraphicsDocument,
  siblings: readonly string[],
  index: number,
  count: number
): readonly SortKey[] {
  return sortKeysBetween(
    nodeSortKey(doc, siblings[index - 1]),
    nodeSortKey(doc, siblings[index]),
    count
  );
}
