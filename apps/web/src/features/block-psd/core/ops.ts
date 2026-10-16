/**
 * Engine operations the editor's commands send, built from what the
 * layers panel shows (rows top to bottom) and the active layer.
 */

import type {
  Brush,
  LayerRow,
  NewLayer,
  Op,
  Position,
  Target,
} from '@core/psd-engine/types';
import { layerBelow } from './layer-tree';

/**
 * Where a new layer goes: above the active layer in its stack (the top of
 * the document when nothing is active).
 */
function newLayerPlace(active: LayerRow | undefined): {
  parent: number | null;
  position: Position;
} {
  if (!active) return { parent: null, position: { type: 'top' } };
  return { parent: active.parent, position: { type: 'above', id: active.id } };
}

/** The name Photoshop gives the next new layer: "Layer" and a number. */
export function nextLayerName(rows: readonly LayerRow[]): string {
  let last = 0;
  for (const row of rows) {
    const m = /^Layer (\d+)$/.exec(row.name);
    if (m) last = Math.max(last, Number(m[1]));
  }
  return `Layer ${last + 1}`;
}

/** A new layer of a kind above the active one. */
export function newLayerOp(
  active: LayerRow | undefined,
  kind: NewLayer,
  name: string | null = null
): Op {
  return { op: 'newLayer', ...newLayerPlace(active), name, kind };
}

/** One batch of a brush stroke's points. */
export function paintOp(args: {
  layer: number;
  target: Target;
  stroke: number;
  brush: Brush;
  points: [number, number, number][];
  done: boolean;
}): Op {
  return {
    op: 'paint',
    id: args.layer,
    target: args.target,
    stroke: args.stroke,
    brush: args.brush,
    points: args.points,
    done: args.done,
  };
}

/**
 * Merge Down: the active layer into the one below it in its stack;
 * undefined when there is none (the bottom of a stack).
 */
export function mergeDownOp(
  rows: readonly LayerRow[],
  active: number
): Op | undefined {
  return layerBelow(rows, active) ? { op: 'merge', ids: [active] } : undefined;
}

/** Toggles clipping to the layer below (not for the Background). */
export function clippingOp(row: LayerRow): Op | undefined {
  if (row.background || row.kind === 'group') return undefined;
  return { op: 'setLayer', ids: [row.id], clipping: !row.clipping };
}

/** Whether a layer's own pixels can be painted (not text, shapes, …). */
export function paintable(row: LayerRow, target: Target): boolean {
  if (target === 'mask') return row.hasMask;
  return row.kind === 'pixel' && !row.locks.pixels;
}

/** Whether a layer can be moved. */
export const movable = (row: LayerRow) =>
  !row.locks.position && !row.background;

/** The undo key that makes a run of steps (one gesture) undo together. */
export function gestureKey(kind: string, id: number | string): string {
  return `${kind}-${id}`;
}
