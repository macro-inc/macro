/**
 * Multi-shape selection geometry: bounding boxes, marquee picking, group
 * scaling, and the align/distribute commands. Pure; units are points.
 */

import type { EditOp, ShapeOutline } from '@core/pptx-engine/types';
import { type Box, boxOf, corners, type Point } from './geometry';

/** An axis-aligned rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The axis-aligned bounds of a (rotated) box. */
export function boundsOf(box: Box): Rect {
  const pts = corners(box);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The axis-aligned bounds around several boxes. */
export function unionBounds(boxes: Box[]): Rect | undefined {
  if (boxes.length === 0) return undefined;
  const rects = boxes.map(boundsOf);
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** The rectangle spanned by two drag points. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Shapes lying entirely inside `rect` (as a marquee selects them). */
export function shapesInRect(shapes: ShapeOutline[], rect: Rect): number[] {
  return shapes
    .filter((s) => !s.hidden)
    .filter((s) => {
      const b = boundsOf(boxOf(s));
      return (
        b.x >= rect.x - 0.01 &&
        b.y >= rect.y - 0.01 &&
        b.x + b.w <= rect.x + rect.w + 0.01 &&
        b.y + b.h <= rect.y + rect.h + 0.01
      );
    })
    .map((s) => s.id);
}

/**
 * Where a box goes when the selection bounds `from` are resized to `to`:
 * positions and sizes scale with the bounds, rotation stays.
 */
export function scaleBox(box: Box, from: Rect, to: Rect): Box {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  return {
    x: to.x + (box.x - from.x) * sx,
    y: to.y + (box.y - from.y) * sy,
    w: Math.max(1, box.w * sx),
    h: Math.max(1, box.h * sy),
    rotation: box.rotation,
  };
}

export type AlignMode =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distributeH'
  | 'distributeV';

/**
 * Moves that align or distribute shapes, PowerPoint-style. A single shape
 * (or `toSlide`) aligns to the slide; several align to their joint bounds.
 */
export function alignOps(
  slide: number,
  shapes: ShapeOutline[],
  mode: AlignMode,
  slideSize: { w: number; h: number },
  toSlide = false
): EditOp[] {
  if (shapes.length === 0) return [];
  const items = shapes.map((s) => ({ s, b: boundsOf(boxOf(s)) }));
  const frame: Rect =
    toSlide || shapes.length === 1
      ? { x: 0, y: 0, w: slideSize.w, h: slideSize.h }
      : (unionBounds(shapes.map(boxOf)) as Rect);
  const moves = new Map<number, { dx: number; dy: number }>();
  const move = (id: number, dx: number, dy: number) => {
    if (Math.abs(dx) > 1e-3 || Math.abs(dy) > 1e-3) moves.set(id, { dx, dy });
  };
  if (mode === 'distributeH' || mode === 'distributeV') {
    const horizontal = mode === 'distributeH';
    const sorted = [...items].sort((a, b) =>
      horizontal ? a.b.x - b.b.x : a.b.y - b.b.y
    );
    const total = sorted.reduce(
      (sum, i) => sum + (horizontal ? i.b.w : i.b.h),
      0
    );
    const start = horizontal ? frame.x : frame.y;
    const span = horizontal ? frame.w : frame.h;
    // The outermost shapes go to the frame's edges and the gaps even out;
    // a lone shape is centered.
    const gap = sorted.length === 1 ? 0 : (span - total) / (sorted.length - 1);
    let at = sorted.length === 1 ? start + (span - total) / 2 : start;
    for (const i of sorted) {
      const d = at - (horizontal ? i.b.x : i.b.y);
      move(i.s.id, horizontal ? d : 0, horizontal ? 0 : d);
      at += (horizontal ? i.b.w : i.b.h) + gap;
    }
  } else {
    for (const { s, b } of items) {
      switch (mode) {
        case 'left':
          move(s.id, frame.x - b.x, 0);
          break;
        case 'center':
          move(s.id, frame.x + frame.w / 2 - (b.x + b.w / 2), 0);
          break;
        case 'right':
          move(s.id, frame.x + frame.w - (b.x + b.w), 0);
          break;
        case 'top':
          move(s.id, 0, frame.y - b.y);
          break;
        case 'middle':
          move(s.id, 0, frame.y + frame.h / 2 - (b.y + b.h / 2));
          break;
        case 'bottom':
          move(s.id, 0, frame.y + frame.h - (b.y + b.h));
          break;
      }
    }
  }
  return shapes
    .filter((s) => moves.has(s.id))
    .map((s) => {
      const { dx, dy } = moves.get(s.id)!;
      return {
        op: 'setTransform' as const,
        slide,
        shape: s.id,
        x: s.x + dx,
        y: s.y + dy,
      };
    });
}

/** Sets a selection's size: one shape exactly, several scaled together. */
export function sizeOps(
  slide: number,
  shapes: ShapeOutline[],
  size: { w?: number; h?: number }
): EditOp[] {
  return shapes.map((s) => ({
    op: 'setTransform' as const,
    slide,
    shape: s.id,
    ...(size.w !== undefined ? { w: Math.max(1, size.w) } : {}),
    ...(size.h !== undefined ? { h: Math.max(1, size.h) } : {}),
  }));
}

/** Rotates or flips each shape about its own center. */
export function rotateOps(
  slide: number,
  shapes: ShapeOutline[],
  change: 'right90' | 'left90' | 'flipH' | 'flipV'
): EditOp[] {
  return shapes.map((s) => {
    switch (change) {
      case 'right90':
        return {
          op: 'setTransform' as const,
          slide,
          shape: s.id,
          rotation: (((s.rotation + 90) % 360) + 360) % 360,
        };
      case 'left90':
        return {
          op: 'setTransform' as const,
          slide,
          shape: s.id,
          rotation: (((s.rotation - 90) % 360) + 360) % 360,
        };
      case 'flipH':
        return {
          op: 'setTransform' as const,
          slide,
          shape: s.id,
          flipH: !s.flipH,
        };
      case 'flipV':
        return {
          op: 'setTransform' as const,
          slide,
          shape: s.id,
          flipV: !s.flipV,
        };
    }
  });
}

/**
 * Z-order moves for several shapes at once. Applying them in this order
 * keeps the selected shapes' order among themselves.
 */
export function reorderOps(
  slide: number,
  shapes: ShapeOutline[],
  allShapes: ShapeOutline[],
  to: 'front' | 'back' | 'forward' | 'backward'
): Extract<EditOp, { op: 'reorderShape' }>[] {
  const order = new Map(allShapes.map((s, i) => [s.id, i]));
  const sorted = [...shapes].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  );
  // Each op moves one shape past its neighbours; ordering the ops this way
  // keeps the selected shapes in their original order among themselves.
  const ascending = to === 'front' || to === 'backward';
  const list = ascending ? sorted : sorted.reverse();
  return list.map((s) => ({
    op: 'reorderShape' as const,
    slide,
    shape: s.id,
    to,
  }));
}
