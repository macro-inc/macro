/**
 * The layers panel's tree: which rows show (inside expanded groups), how a
 * row dropped above, below, or into another becomes a `move`, and range
 * selection by panel order.
 */

import type { LayerRow, Position } from '@core/psd-engine/types';

/** Rows inside collapsed groups are hidden. */
export function visibleRows(rows: readonly LayerRow[]): LayerRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hidden = (row: LayerRow): boolean => {
    let parent = row.parent === null ? undefined : byId.get(row.parent);
    while (parent) {
      if (!parent.open) return true;
      parent = parent.parent === null ? undefined : byId.get(parent.parent);
    }
    return false;
  };
  return rows.filter((r) => !hidden(r));
}

/** Whether `id` is `ancestor` or inside it. */
export function isWithin(
  rows: readonly LayerRow[],
  id: number,
  ancestor: number
): boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let at: LayerRow | undefined = byId.get(id);
  while (at) {
    if (at.id === ancestor) return true;
    at = at.parent === null ? undefined : byId.get(at.parent);
  }
  return false;
}

/** Where on a row the pointer is: its top, middle (groups), or bottom. */
export type DropZone = 'before' | 'inside' | 'after';

/** The zone for a pointer `fraction` (0 top, 1 bottom) down a row. */
export function dropZone(row: LayerRow, fraction: number): DropZone {
  if (row.kind === 'group') {
    if (fraction < 0.25) return 'before';
    if (fraction > 0.75) return 'after';
    return 'inside';
  }
  return fraction < 0.5 ? 'before' : 'after';
}

/**
 * The `move` that drops `dragged` layers on `target` at a zone: above it
 * (before, in the panel), below it, or into a group (on top). Undefined
 * when a group would go inside itself or nothing would change.
 */
export function dropPlacement(
  rows: readonly LayerRow[],
  dragged: readonly number[],
  target: LayerRow,
  zone: DropZone
): { parent: number | null; position: Position } | undefined {
  if (dragged.includes(target.id)) return undefined;
  let parent: number | null;
  let position: Position;
  if (zone === 'inside' || (zone === 'after' && target.kind === 'group' && target.open && target.children > 0)) {
    // Into the group, on top of its stack (first under it in the panel).
    parent = target.id;
    position = { type: 'top' };
  } else {
    parent = target.parent;
    position =
      zone === 'before'
        ? { type: 'above', id: target.id }
        : { type: 'below', id: target.id };
  }
  if (parent !== null && dragged.some((id) => isWithin(rows, parent ?? -1, id)))
    return undefined;
  // The Background stays at the bottom.
  if (target.background && zone !== 'before') return undefined;
  return { parent, position };
}

/** Rows between two (inclusive) in panel order, for Shift-click. */
export function rangeBetween(
  rows: readonly LayerRow[],
  from: number,
  to: number
): number[] {
  const a = rows.findIndex((r) => r.id === from);
  const b = rows.findIndex((r) => r.id === to);
  if (a < 0 || b < 0) return [to];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return rows.slice(lo, hi + 1).map((r) => r.id);
}

/** The layer below `id` in its own stack (Merge Down's partner). */
export function layerBelow(
  rows: readonly LayerRow[],
  id: number
): LayerRow | undefined {
  const at = rows.findIndex((r) => r.id === id);
  const row = rows[at];
  if (!row) return undefined;
  for (let i = at + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.depth < row.depth) return undefined;
    if (r.depth === row.depth && r.parent === row.parent) return r;
  }
  return undefined;
}

/** The layer that should be active when nothing is: the top one. */
export function defaultActive(rows: readonly LayerRow[]): number | undefined {
  return rows[0]?.id;
}
