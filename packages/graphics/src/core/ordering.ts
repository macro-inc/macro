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

export function children(
  doc: GraphicsDocument,
  parentId = doc.rootId
): readonly string[] {
  return Object.values(doc.items)
    .filter(
      (node) => node.type !== 'surface' && node.placement.parentId === parentId
    )
    .sort((a, b) => {
      if (a.type === 'surface' || b.type === 'surface') return 0;
      const left = a.placement.sortKey,
        right = b.placement.sortKey;
      // Deliberately use code-unit comparison, never localeCompare.
      return left < right
        ? -1
        : left > right
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;
    })
    .map((node) => node.id);
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
