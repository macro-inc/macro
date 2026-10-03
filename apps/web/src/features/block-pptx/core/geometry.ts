/**
 * Slide-space geometry for selection, hit testing, and transforms. Units are
 * points; rotation is clockwise degrees about the shape's center, as in OOXML.
 */

import type { ShapeOutline } from '@core/pptx-engine/types';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Clockwise degrees. */
  rotation: number;
}

export type Affine = [number, number, number, number, number, number];

export function applyAffine(t: Affine, p: Point): Point {
  const [a, b, c, d, e, f] = t;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

export function invertAffine(t: Affine): Affine | null {
  const [a, b, c, d, e, f] = t;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function center(b: Box): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Rotates `p` about `c` by `deg` clockwise (y grows downward). */
export function rotateAbout(p: Point, c: Point, deg: number): Point {
  const r = rad(deg);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** `p` in the box's unrotated frame. */
export function toLocal(b: Box, p: Point): Point {
  return rotateAbout(p, center(b), -b.rotation);
}

export function boxOf(s: ShapeOutline): Box {
  return { x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation };
}

/** Whether `p` lies inside the (rotated) box, grown by `slop` points. */
export function boxContains(b: Box, p: Point, slop = 0): boolean {
  const q = toLocal(b, p);
  return (
    q.x >= b.x - slop &&
    q.x <= b.x + b.w + slop &&
    q.y >= b.y - slop &&
    q.y <= b.y + b.h + slop
  );
}

/** The four corners, clockwise from the top-left, rotated. */
export function corners(b: Box): Point[] {
  const c = center(b);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ].map((p) => rotateAbout(p, c, b.rotation));
}

/**
 * The topmost visible shape under `p` (shapes are listed back to front).
 * Lines and other thin shapes get a few points of slop so they can be hit.
 */
export function hitTest(
  shapes: ShapeOutline[],
  p: Point,
  slop = 3
): ShapeOutline | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.hidden) continue;
    const thin = Math.min(s.w, s.h) < 2 * slop;
    if (boxContains(boxOf(s), p, thin ? slop : 0)) return s;
  }
  return undefined;
}

/** Resize handles: corners and edge midpoints. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Unit position of a handle within the box (0..1 on each axis). */
export function handleUnit(h: Handle): Point {
  const x = h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5;
  const y = h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5;
  return { x, y };
}

export function handlePosition(b: Box, h: Handle): Point {
  const u = handleUnit(h);
  return rotateAbout(
    { x: b.x + u.x * b.w, y: b.y + u.y * b.h },
    center(b),
    b.rotation
  );
}

/** Where the rotation handle sits: above the top edge, rotated with the box. */
export function rotationHandlePosition(b: Box, offset: number): Point {
  return rotateAbout(
    { x: b.x + b.w / 2, y: b.y - offset },
    center(b),
    b.rotation
  );
}

/**
 * Resizes a box by dragging `handle` to `p`, keeping the opposite handle
 * fixed in slide space. With `keepAspect` (Shift, or corner handles of
 * pictures), the original aspect ratio is preserved.
 */
export function resizeBox(
  b: Box,
  handle: Handle,
  p: Point,
  keepAspect = false,
  minSize = 1
): Box {
  const u = handleUnit(handle);
  const anchorUnit = { x: 1 - u.x, y: 1 - u.y };
  const anchor = rotateAbout(
    { x: b.x + anchorUnit.x * b.w, y: b.y + anchorUnit.y * b.h },
    center(b),
    b.rotation
  );
  // The drag vector from the anchor, in the box's unrotated frame.
  const d = rotateAbout(p, anchor, -b.rotation);
  let w = u.x === 0.5 ? b.w : Math.abs(d.x - anchor.x);
  let h = u.y === 0.5 ? b.h : Math.abs(d.y - anchor.y);
  if (keepAspect && b.w > 0 && b.h > 0) {
    const ratio = b.w / b.h;
    if (u.x === 0.5) w = h * ratio;
    else if (u.y === 0.5) h = w / ratio;
    else if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(minSize, w);
  h = Math.max(minSize, h);
  // Place the new box so the anchor stays put.
  const sx = u.x === 0.5 ? 0.5 : anchorUnit.x;
  const sy = u.y === 0.5 ? 0.5 : anchorUnit.y;
  const fixed =
    u.x === 0.5 || u.y === 0.5
      ? rotateAbout(
          {
            x: b.x + (u.x === 0.5 ? 0.5 : anchorUnit.x) * b.w,
            y: b.y + (u.y === 0.5 ? 0.5 : anchorUnit.y) * b.h,
          },
          center(b),
          b.rotation
        )
      : anchor;
  // Center of the new box: from the fixed point, go to the center in the rotated frame.
  const offset = rotateAbout(
    { x: (0.5 - sx) * w, y: (0.5 - sy) * h },
    { x: 0, y: 0 },
    b.rotation
  );
  const c = { x: fixed.x + offset.x, y: fixed.y + offset.y };
  return { x: c.x - w / 2, y: c.y - h / 2, w, h, rotation: b.rotation };
}

/** The rotation (degrees, 0..360) that points the rotation handle at `p`. */
export function rotationToward(b: Box, p: Point, snap = 15): number {
  const c = center(b);
  const deg = (Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI;
  const snapped = snap > 0 ? Math.round(deg / snap) * snap : deg;
  return ((snapped % 360) + 360) % 360;
}
