/**
 * The layer tree as the layers panel and the arrange commands use it: the
 * rows shown under expanded layers and groups, where a dragged row lands,
 * range selection, and moving objects up and down their stacks.
 *
 * Rows come top to bottom, depth first, as Illustrator's panel lists them:
 * a container's children follow it, topmost first.
 */

export interface LayerRow {
  id: number;
  parent: number | null;
  depth: number;
  kind: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  children: number;
}

/** Where a node goes among its new siblings. */
export type Position =
  | { type: 'top' }
  | { type: 'bottom' }
  | { type: 'above'; id: number }
  | { type: 'below'; id: number };

/** A move of nodes into a container (`parent` null: layers). */
export interface Move {
  ids: number[];
  parent: number | null;
  position: Position;
}

export const isContainer = (row: Pick<LayerRow, 'kind'>) =>
  row.kind === 'layer' || row.kind === 'group' || row.kind === 'clipGroup';

/** The rows shown: those whose ancestors are all expanded. */
export function visibleRows<T extends LayerRow>(
  rows: readonly T[],
  expanded: ReadonlySet<number>
): T[] {
  const out: T[] = [];
  let hiddenBelow = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.depth > hiddenBelow) continue;
    hiddenBelow = Number.POSITIVE_INFINITY;
    out.push(row);
    if (row.children > 0 && !expanded.has(row.id)) hiddenBelow = row.depth;
  }
  return out;
}

/** A node's ancestors, outermost (its layer) first. */
export function ancestorsOf(rows: readonly LayerRow[], id: number): number[] {
  const parents = new Map(rows.map((r) => [r.id, r.parent]));
  const out: number[] = [];
  let at = parents.get(id) ?? null;
  while (at !== null && !out.includes(at)) {
    out.unshift(at);
    at = parents.get(at) ?? null;
  }
  return out;
}

/** The layer a node is in (itself for a layer). */
export function layerOf(rows: readonly LayerRow[], id: number): number {
  return ancestorsOf(rows, id)[0] ?? id;
}

/** Of some nodes, those not inside another of them. */
export function outermost(rows: readonly LayerRow[], ids: readonly number[]) {
  const set = new Set(ids);
  return ids.filter((id) => !ancestorsOf(rows, id).some((a) => set.has(a)));
}

/** Ids in stacking order, bottom first (the panel lists top first). */
export function bottomFirst(
  rows: readonly LayerRow[],
  ids: readonly number[]
): number[] {
  const index = new Map(rows.map((r, i) => [r.id, i]));
  return [...ids].sort((a, b) => (index.get(b) ?? -1) - (index.get(a) ?? -1));
}

/** Where a drop on a row lands, by the part of the row it is over. */
export type DropZone = 'above' | 'below' | 'inside';

/**
 * The move a drag of `dragged` rows onto `target` makes, or undefined
 * when it cannot land there (into itself, layers into objects). Layers
 * reorder among layers; objects dropped on a layer go on top of it, into
 * a group when dropped inside it, and otherwise beside the row.
 */
export function dropMove(
  rows: readonly LayerRow[],
  dragged: readonly number[],
  target: LayerRow,
  zone: DropZone
): Move | undefined {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const moving = bottomFirst(
    rows,
    outermost(rows, dragged).filter((id) => byId.has(id))
  );
  if (moving.length === 0) return undefined;
  const lineage = [...ancestorsOf(rows, target.id), target.id];
  if (moving.some((id) => lineage.includes(id))) return undefined;
  const layers = moving.filter((id) => byId.get(id)?.depth === 0);
  if (layers.length > 0) {
    if (layers.length !== moving.length) return undefined;
    // Layers stay at the top of the tree: beside the target's layer.
    const layer = layerOf(rows, target.id);
    const below = zone === 'below' && target.depth === 0;
    return {
      ids: moving,
      parent: null,
      position: below
        ? { type: 'below', id: layer }
        : { type: 'above', id: layer },
    };
  }
  if (target.depth === 0 || (zone === 'inside' && isContainer(target)))
    return { ids: moving, parent: target.id, position: { type: 'top' } };
  return {
    ids: moving,
    parent: target.parent,
    position:
      zone === 'below'
        ? { type: 'below', id: target.id }
        : { type: 'above', id: target.id },
  };
}

/** Ids from `from` to `to` (inclusive) in the order shown. */
export function rangeIds(
  shown: readonly number[],
  from: number,
  to: number
): number[] {
  const a = shown.indexOf(from);
  const b = shown.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return shown.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** The direct children of a container, bottom first (stacking order). */
export function stackOf(rows: readonly LayerRow[], parent: number | null) {
  return rows
    .filter((r) => r.parent === parent)
    .map((r) => r.id)
    .reverse();
}

export type Arrangement = 'front' | 'forward' | 'backward' | 'back';

/**
 * Illustrator's Arrange commands as moves: to the front or back of each
 * stack (keeping the selected objects' order), or one step: each selected
 * object passes the next unselected object above (or below) it.
 */
export function arrangeMoves(
  rows: readonly LayerRow[],
  ids: readonly number[],
  how: Arrangement
): Move[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const selected = new Set(outermost(rows, ids).filter((id) => byId.has(id)));
  const parents = [
    ...new Set([...selected].map((id) => byId.get(id)?.parent ?? null)),
  ];
  const moves: Move[] = [];
  for (const parent of parents) {
    const stack = stackOf(rows, parent);
    const mine = stack.filter((id) => selected.has(id));
    if (mine.length === 0) continue;
    if (how === 'front' || how === 'back') {
      moves.push({
        ids: mine,
        parent,
        position: { type: how === 'front' ? 'top' : 'bottom' },
      });
      continue;
    }
    const order = [...stack];
    const up = how === 'forward';
    for (const id of up ? [...mine].reverse() : mine) {
      const at = order.indexOf(id);
      const next = order[up ? at + 1 : at - 1];
      if (next === undefined || selected.has(next)) continue;
      order.splice(at, 1);
      order.splice(order.indexOf(next) + (up ? 1 : 0), 0, id);
      moves.push({
        ids: [id],
        parent,
        position: up
          ? { type: 'above', id: next }
          : { type: 'below', id: next },
      });
    }
  }
  return moves;
}

/** The objects Select All picks: those directly in shown, unlocked layers. */
export function selectableIds(rows: readonly LayerRow[]): number[] {
  const open = new Set(
    rows.filter((r) => r.depth === 0 && !r.hidden && !r.locked).map((r) => r.id)
  );
  return rows
    .filter(
      (r) =>
        r.depth === 1 &&
        r.parent !== null &&
        open.has(r.parent) &&
        !r.hidden &&
        !r.locked
    )
    .map((r) => r.id);
}
