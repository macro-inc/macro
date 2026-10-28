/**
 * Selection in the layers panel, as Figma's layer list handles it: a
 * Shift-click selects the rows between the last clicked one and this one,
 * ⌘/Ctrl-click toggles one row, and the arrow keys move through the rows
 * shown (Left and Right collapse and expand).
 */

/** What a click on a row does to the selection. */
export type RowClick =
  | { kind: 'select'; ids: string[] }
  | { kind: 'toggle'; id: string };

/**
 * The selection after clicking `id` among the rows shown (`order`, top
 * first), given the row last clicked without Shift (`anchor`).
 */
export function rowClick(
  order: readonly string[],
  id: string,
  anchor: string | undefined,
  mods: { shift: boolean; toggle: boolean }
): RowClick {
  if (mods.toggle) return { kind: 'toggle', id };
  if (mods.shift && anchor !== undefined) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return { kind: 'select', ids: order.slice(lo, hi + 1) };
    }
  }
  return { kind: 'select', ids: [id] };
}

export interface TreeRow {
  id: string;
  /** Parent row id; undefined at the top level. */
  parent: string | undefined;
  hasChildren: boolean;
  expanded: boolean;
}

/** What an arrow key does in the layer tree. */
export type TreeMove =
  | { kind: 'select'; id: string }
  | { kind: 'expand'; id: string }
  | { kind: 'collapse'; id: string };

/**
 * The move for an arrow key from the row `current` (the last selected),
 * or nothing at the ends of the list.
 */
export function treeMove(
  rows: readonly TreeRow[],
  current: string | undefined,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
): TreeMove | undefined {
  const at = rows.findIndex((r) => r.id === current);
  if (at < 0) {
    const first = rows[0];
    return first ? { kind: 'select', id: first.id } : undefined;
  }
  const row = rows[at];
  switch (key) {
    case 'ArrowUp': {
      const prev = rows[at - 1];
      return prev ? { kind: 'select', id: prev.id } : undefined;
    }
    case 'ArrowDown': {
      const next = rows[at + 1];
      return next ? { kind: 'select', id: next.id } : undefined;
    }
    case 'ArrowRight':
      if (!row.hasChildren) return undefined;
      if (!row.expanded) return { kind: 'expand', id: row.id };
      return rows[at + 1]?.parent === row.id
        ? { kind: 'select', id: rows[at + 1].id }
        : undefined;
    case 'ArrowLeft':
      if (row.hasChildren && row.expanded)
        return { kind: 'collapse', id: row.id };
      return row.parent ? { kind: 'select', id: row.parent } : undefined;
  }
}
