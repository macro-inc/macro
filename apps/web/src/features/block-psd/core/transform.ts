/**
 * Free Transform (⌘T): a box around the layers that is moved, scaled by
 * its handles, and rotated outside its corners, as Photoshop does. The
 * state is the box as it now stands (center, signed size, angle) over the
 * box it started as; the engine gets the affine map between them.
 *
 * Corner handles keep the proportions unless Shift is held (Photoshop's
 * default since 2019); Alt scales about the center; Shift snaps rotation
 * to 15° steps.
 */

import type { IRect, Matrix } from '@core/psd-engine/types';
import type { Point } from './selection-math';

export interface FreeTransform {
  /** The box the layers started in (canvas pixels). */
  start: IRect;
  /** The box's center now. */
  cx: number;
  cy: number;
  /** Its size now; negative when flipped. */
  w: number;
  h: number;
  /** Radians, clockwise on screen. */
  angle: number;
}

/** Handle positions by their sides: `[x, y]` each -1, 0, or 1. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_SIDES: Record<Handle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

export const HANDLES = Object.keys(HANDLE_SIDES) as Handle[];

export function startTransform(box: IRect): FreeTransform {
  return {
    start: box,
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2,
    w: box.w,
    h: box.h,
    angle: 0,
  };
}

const axes = (t: FreeTransform) => {
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return { u: { x: cos, y: sin }, v: { x: -sin, y: cos } };
};

/** A point of the box by its sides (`-1..1` across each axis). */
export function boxPoint(t: FreeTransform, sx: number, sy: number): Point {
  const { u, v } = axes(t);
  return {
    x: t.cx + ((sx * t.w) / 2) * u.x + ((sy * t.h) / 2) * v.x,
    y: t.cy + ((sx * t.w) / 2) * u.y + ((sy * t.h) / 2) * v.y,
  };
}

/** The box's corners, clockwise from the top left. */
export function corners(t: FreeTransform): Point[] {
  return [
    boxPoint(t, -1, -1),
    boxPoint(t, 1, -1),
    boxPoint(t, 1, 1),
    boxPoint(t, -1, 1),
  ];
}

/** The map from the starting box to the box now. */
export function matrixOf(t: FreeTransform): Matrix {
  const sx = t.start.w > 0 ? t.w / t.start.w : 1;
  const sy = t.start.h > 0 ? t.h / t.start.h : 1;
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  // Rotate · scale, about the start's center, then to the center now.
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const scx = t.start.x + t.start.w / 2;
  const scy = t.start.y + t.start.h / 2;
  return [a, b, c, d, t.cx - (a * scx + c * scy), t.cy - (b * scx + d * scy)];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Whether the box has only moved (no scale, flip, or rotation). */
export function isTranslation(t: FreeTransform): boolean {
  return (
    near(t.w, t.start.w) &&
    near(t.h, t.start.h) &&
    near(((t.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 0)
  );
}

/** Whether the box is where it started. */
export function isIdentity(t: FreeTransform): boolean {
  return (
    isTranslation(t) &&
    near(t.cx, t.start.x + t.start.w / 2) &&
    near(t.cy, t.start.y + t.start.h / 2)
  );
}

export function moveBy(t: FreeTransform, dx: number, dy: number) {
  return { ...t, cx: t.cx + dx, cy: t.cy + dy };
}

/**
 * The box with `handle` dragged to `p`. Corners keep the proportions when
 * `proportional`; `centered` scales about the center.
 */
export function dragHandle(
  t: FreeTransform,
  handle: Handle,
  p: Point,
  options: { proportional: boolean; centered: boolean }
): FreeTransform {
  const [hx, hy] = HANDLE_SIDES[handle];
  const { u, v } = axes(t);
  const anchor = options.centered
    ? { x: t.cx, y: t.cy }
    : boxPoint(t, -hx, -hy);
  const d = { x: p.x - anchor.x, y: p.y - anchor.y };
  const du = d.x * u.x + d.y * u.y;
  const dv = d.x * v.x + d.y * v.y;
  const span = options.centered ? 2 : 1;
  let w = hx !== 0 ? du * hx * span : t.w;
  let h = hy !== 0 ? dv * hy * span : t.h;
  if (options.proportional && hx !== 0 && hy !== 0 && t.w !== 0 && t.h !== 0) {
    const kx = w / t.w;
    const ky = h / t.h;
    const k = Math.abs(kx) > Math.abs(ky) ? kx : ky;
    w = t.w * k;
    h = t.h * k;
  }
  // Never collapse to nothing.
  if (Math.abs(w) < 1) w = w < 0 ? -1 : 1;
  if (Math.abs(h) < 1) h = h < 0 ? -1 : 1;
  if (options.centered) return { ...t, w, h };
  // The anchor stays where it is.
  const ox = hx !== 0 ? (hx * w) / 2 : 0;
  const oy = hy !== 0 ? (hy * h) / 2 : 0;
  // For an edge, the anchor is on the center line across it.
  return {
    ...t,
    w,
    h,
    cx: anchor.x + ox * u.x + oy * v.x,
    cy: anchor.y + ox * u.y + oy * v.y,
  };
}

/** Rotation steps with Shift. */
const SNAP = Math.PI / 12;

/**
 * The box turned by the pointer's sweep around its center since the
 * rotation began (`from` is the pointer then, `startAngle` the box's).
 */
export function rotateTo(
  t: FreeTransform,
  startAngle: number,
  from: Point,
  p: Point,
  snap: boolean
): FreeTransform {
  const a0 = Math.atan2(from.y - t.cy, from.x - t.cx);
  const a1 = Math.atan2(p.y - t.cy, p.x - t.cx);
  let angle = startAngle + (a1 - a0);
  if (snap) angle = Math.round(angle / SNAP) * SNAP;
  return { ...t, angle };
}

/** The degrees the box is turned, `-180..180`. */
export function degrees(t: FreeTransform): number {
  let d = (t.angle * 180) / Math.PI;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return Math.round(d * 100) / 100;
}

/** Which part of the box a canvas point is on, within `slop` pixels. */
export function hitTransform(
  t: FreeTransform,
  p: Point,
  slop: number
):
  | { kind: 'handle'; handle: Handle }
  | { kind: 'move' }
  | { kind: 'rotate' }
  | undefined {
  for (const handle of HANDLES) {
    const [sx, sy] = HANDLE_SIDES[handle];
    const h = boxPoint(t, sx, sy);
    if (Math.hypot(p.x - h.x, p.y - h.y) <= slop)
      return { kind: 'handle', handle };
  }
  const { u, v } = axes(t);
  const d = { x: p.x - t.cx, y: p.y - t.cy };
  const lu = Math.abs(d.x * u.x + d.y * u.y);
  const lv = Math.abs(d.x * v.x + d.y * v.y);
  const hw = Math.abs(t.w) / 2;
  const hh = Math.abs(t.h) / 2;
  if (lu <= hw && lv <= hh) return { kind: 'move' };
  if (lu <= hw + slop * 4 && lv <= hh + slop * 4) return { kind: 'rotate' };
  return undefined;
}
