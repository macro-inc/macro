/**
 * Canvas geometry for the Illustrator editor: points and rectangles in
 * points (y down), affine matrices as Illustrator writes them, and the
 * selection box's handles, scaling, and rotation.
 */

export interface Point {
  x: number;
  y: number;
}

/** A rectangle by its corner and size, as the UI measures. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle by its edges, as the engine stores it. */
export interface EdgeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** `[a, b, c, d, e, f]`: `(x, y)` to `(a·x + c·y + e, b·x + d·y + f)`. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const toRect = (r: EdgeRect): Rect => ({
  x: r.x0,
  y: r.y0,
  w: r.x1 - r.x0,
  h: r.y1 - r.y0,
});

export const toEdges = (r: Rect): EdgeRect => ({
  x0: r.x,
  y0: r.y,
  x1: r.x + r.w,
  y1: r.y + r.h,
});

/**
 * An object's geometric bounds (strokes left out, as Illustrator measures
 * it), else its drawn bounds.
 */
export function geometricRect(o: {
  shapeBounds: EdgeRect | null;
  bounds: EdgeRect | null;
}): Rect | undefined {
  const b = o.shapeBounds ?? o.bounds;
  return b ? toRect(b) : undefined;
}

/** The rectangle two corners span. */
export function spanRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** The union of rectangles (`undefined` for none). */
export function unionOf(rects: readonly Rect[]): Rect | undefined {
  let out: Rect | undefined;
  for (const r of rects) {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) continue;
    if (!out) {
      out = { ...r };
      continue;
    }
    const x = Math.min(out.x, r.x);
    const y = Math.min(out.y, r.y);
    out = {
      x,
      y,
      w: Math.max(out.x + out.w, r.x + r.w) - x,
      h: Math.max(out.y + out.h, r.y + r.h) - y,
    };
  }
  return out;
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

export const center = (r: Rect): Point => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});

/** `m`, then `n` (as PDF's `cm` composes). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function invert(m: Matrix): Matrix | undefined {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}

export function apply(m: Matrix, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

export const translate = (dx: number, dy: number): Matrix => [
  1,
  0,
  0,
  1,
  dx,
  dy,
];

/** Scales by `sx`, `sy` about a point. */
export function scaleAbout(sx: number, sy: number, origin: Point): Matrix {
  return [sx, 0, 0, sy, origin.x * (1 - sx), origin.y * (1 - sy)];
}

/** Turns by `radians` (clockwise on the y-down canvas) about a point. */
export function rotateAbout(radians: number, origin: Point): Matrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return multiply(
    multiply(translate(-origin.x, -origin.y), [cos, sin, -sin, cos, 0, 0]),
    translate(origin.x, origin.y)
  );
}

/** The map taking one rectangle onto another (scale, then move). */
export function rectToRect(from: Rect, to: Rect): Matrix {
  const sx = from.w > 1e-9 ? to.w / from.w : 1;
  const sy = from.h > 1e-9 ? to.h / from.h : 1;
  return [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy];
}

/** The rotation a matrix applies, in degrees (counter-clockwise positive). */
export function rotationOf(m: Matrix): number {
  // Canvas y points down, so an Illustrator angle turns the other way.
  const degrees = (-Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const rounded = Math.round(degrees * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** The selection box's eight handles. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: readonly Handle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

/** Where a handle sits on a rectangle. */
export function handlePoint(r: Rect, h: Handle): Point {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/**
 * The handle within `reach` of a point (both in screen pixels), corners
 * first; edges' middle handles only when the box is big enough to grab.
 */
export function handleAt(
  box: Rect,
  p: Point,
  reach: number
): Handle | undefined {
  const near = (h: Handle) => {
    const at = handlePoint(box, h);
    return Math.abs(at.x - p.x) <= reach && Math.abs(at.y - p.y) <= reach;
  };
  const corner = (['nw', 'ne', 'se', 'sw'] as const).find(near);
  if (corner) return corner;
  if (box.w < 3 * reach || box.h < 3 * reach) return undefined;
  return (['n', 'e', 's', 'w'] as const).find(near);
}

/**
 * Whether a point is just outside a corner of the box, where dragging
 * rotates (screen pixels).
 */
export function rotatesAt(
  box: Rect,
  p: Point,
  reach: number,
  ring: number
): boolean {
  if (contains(box, p)) return false;
  return (['nw', 'ne', 'se', 'sw'] as const).some((h) => {
    const at = handlePoint(box, h);
    const d = Math.hypot(at.x - p.x, at.y - p.y);
    return d > reach && d <= reach + ring;
  });
}

/** Which edge of an axis a handle drags: the low one, the high one, or none. */
type Side = -1 | 0 | 1;

const sidesOf = (h: Handle): [Side, Side] => [
  h.includes('w') ? -1 : h.includes('e') ? 1 : 0,
  h.includes('n') ? -1 : h.includes('s') ? 1 : 0,
];

/** One axis of a box being resized. */
interface Axis {
  /** Its low edge. */
  lo: number;
  size: number;
  side: Side;
  fromCenter: boolean;
}

/** Where the axis stays put: the center, or the edge opposite the dragged one. */
const anchorOf = (a: Axis) =>
  a.fromCenter ? a.lo + a.size / 2 : a.side < 0 ? a.lo + a.size : a.lo;

/** How far the dragged edge is from the anchor. */
const reachOf = (a: Axis) => (a.fromCenter ? a.size / 2 : a.size);

/** The scale dragging the axis's edge to `at` gives it (1 when not dragged). */
function axisScale(a: Axis, at: number): number {
  const reach = reachOf(a);
  if (a.side === 0 || reach <= 1e-9) return 1;
  return ((at - anchorOf(a)) * a.side) / reach;
}

/** The axis's low edge and size once scaled by `s` about its anchor. */
function axisSpan(a: Axis, s: number): [number, number] {
  const fixed = anchorOf(a);
  const offset = (a.side < 0 ? -1 : 1) * reachOf(a) * s;
  const near = a.fromCenter ? fixed - offset : fixed;
  const far = fixed + offset;
  return [Math.min(near, far), Math.abs(far - near)];
}

/** Equal scales on the dragged axes, for a drag that keeps proportions. */
function proportional(sx: number, sy: number, sides: [Side, Side]) {
  const [x, y] = sides;
  if (x !== 0 && y !== 0) {
    const k = Math.abs(Math.abs(sx) > Math.abs(sy) ? sx : sy);
    return [Math.sign(sx || 1) * k, Math.sign(sy || 1) * k];
  }
  return x !== 0 ? [sx, Math.abs(sx)] : [Math.abs(sy), sy];
}

function axesOf(start: Rect, handle: Handle, fromCenter: boolean) {
  const [sx, sy] = sidesOf(handle);
  const x: Axis = { lo: start.x, size: start.w, side: sx, fromCenter };
  const y: Axis = { lo: start.y, size: start.h, side: sy, fromCenter };
  return { x, y };
}

/**
 * The box after dragging `handle` of `start` to `p`: `keepRatio` (⇧) keeps
 * the proportions, `fromCenter` (⌥) scales about the center. A handle
 * dragged past the opposite side flips the box.
 */
export function resizeBox(
  start: Rect,
  handle: Handle,
  p: Point,
  options: { keepRatio: boolean; fromCenter: boolean }
): Rect {
  const { x, y } = axesOf(start, handle, options.fromCenter);
  let sx = axisScale(x, p.x);
  let sy = axisScale(y, p.y);
  if (options.keepRatio) [sx, sy] = proportional(sx, sy, [x.side, y.side]);
  const [left, w] = axisSpan(x, sx);
  const [top, h] = axisSpan(y, sy);
  return { x: left, y: top, w: Math.max(w, 1e-3), h: Math.max(h, 1e-3) };
}

/**
 * The matrix a resize drag applies: `start` onto the dragged box, flipped
 * along an axis whose handle crossed the opposite side.
 */
export function resizeMatrix(
  start: Rect,
  handle: Handle,
  p: Point,
  options: { keepRatio: boolean; fromCenter: boolean }
): Matrix {
  const box = resizeBox(start, handle, p, options);
  const m = rectToRect(start, box);
  const { x, y } = axesOf(start, handle, options.fromCenter);
  const flipped = (a: Axis, at: number) =>
    a.side !== 0 && (at - anchorOf(a)) * a.side < 0;
  const flipX = flipped(x, p.x);
  const flipY = flipped(y, p.y);
  if (!flipX && !flipY) return m;
  return multiply(scaleAbout(flipX ? -1 : 1, flipY ? -1 : 1, center(start)), m);
}

/**
 * The angle (radians) a rotate drag has turned, from where it started
 * around `origin`; ⇧ snaps to 45°, as in Illustrator.
 */
export function dragAngle(
  origin: Point,
  from: Point,
  to: Point,
  snap: boolean
): number {
  const a0 = Math.atan2(from.y - origin.y, from.x - origin.x);
  const a1 = Math.atan2(to.y - origin.y, to.x - origin.x);
  let a = a1 - a0;
  if (snap) a = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  return a;
}

/** The end of a line drawn to `p`; ⇧ constrains it to 45° steps. */
export function constrainAngle(start: Point, p: Point, snap: boolean): Point {
  if (!snap) return p;
  const step = Math.PI / 4;
  const angle =
    Math.round(Math.atan2(p.y - start.y, p.x - start.x) / step) * step;
  const len = Math.hypot(p.x - start.x, p.y - start.y);
  return {
    x: start.x + Math.cos(angle) * len,
    y: start.y + Math.sin(angle) * len,
  };
}

/**
 * The rectangle a shape drag draws: ⇧ makes it square, ⌥ draws it from
 * the center out.
 */
export function shapeRect(
  start: Point,
  p: Point,
  options: { square: boolean; fromCenter: boolean }
): Rect {
  let w = p.x - start.x;
  let h = p.y - start.y;
  if (options.square) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * side;
    h = Math.sign(h || 1) * side;
  }
  if (options.fromCenter)
    return {
      x: start.x - Math.abs(w),
      y: start.y - Math.abs(h),
      w: 2 * Math.abs(w),
      h: 2 * Math.abs(h),
    };
  return spanRect(start, { x: start.x + w, y: start.y + h });
}
