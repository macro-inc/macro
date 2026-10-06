/**
 * Paths as Illustrator's direct selection and pen tools see them: anchor
 * points with the handles arriving at and leaving each one, moving an
 * anchor (its handles follow) or a handle (a smooth point stays smooth),
 * and the path the pen's clicks and drags make.
 */

import { apply, type Matrix, type Point } from './geometry';

export type Seg =
  | { type: 'move'; p: Point }
  | { type: 'line'; p: Point }
  | { type: 'cubic'; c1: Point; c2: Point; p: Point }
  | { type: 'close' };

export interface PathData {
  segs: Seg[];
}

/** An anchor point of a path, with where its parts live in `segs`. */
export interface Anchor {
  /** The segment ending at it (`move`, `line`, or `cubic`). */
  seg: number;
  /**
   * A closed subpath's last segment when it returns to its first point:
   * the same anchor, so both move together.
   */
  twin?: number;
  point: Point;
  /** The control point arriving at it (`c2` of segment `inSeg`). */
  handleIn?: Point;
  inSeg?: number;
  /** The control point leaving it (`c1` of segment `outSeg`). */
  handleOut?: Point;
  outSeg?: number;
}

/** Points closer than this (in the path's units) are one point. */
const SAME = 1e-4;

const same = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME;

const endOf = (s: Seg): Point | undefined =>
  s.type === 'close' ? undefined : s.p;

/** Indices of each subpath's segments: its move, drawing ones, and close. */
function subpaths(path: PathData): { segs: number[]; closed: boolean }[] {
  const out: { segs: number[]; closed: boolean }[] = [];
  let current: { segs: number[]; closed: boolean } | undefined;
  path.segs.forEach((s, i) => {
    if (s.type === 'move') {
      current = { segs: [i], closed: false };
      out.push(current);
    } else if (s.type === 'close') {
      if (current) current.closed = true;
      current = undefined;
    } else current?.segs.push(i);
  });
  return out;
}

/** A path's anchor points, in its own space. */
export function anchorsOf(path: PathData): Anchor[] {
  const anchors: Anchor[] = [];
  for (const sub of subpaths(path)) {
    const first = path.segs[sub.segs[0]];
    const last = path.segs[sub.segs[sub.segs.length - 1]];
    const firstPoint = endOf(first);
    // A closed subpath often ends with a segment back to its start: that
    // end is the first anchor again.
    const merged =
      sub.closed &&
      sub.segs.length > 1 &&
      !!firstPoint &&
      !!endOf(last) &&
      same(endOf(last) as Point, firstPoint);
    const count = merged ? sub.segs.length - 1 : sub.segs.length;
    for (let k = 0; k < count; k++) {
      const index = sub.segs[k];
      const s = path.segs[index];
      const point = endOf(s);
      if (!point) continue;
      const anchor: Anchor = { seg: index, point };
      const arriving =
        k === 0 ? (merged ? sub.segs[sub.segs.length - 1] : undefined) : index;
      if (arriving !== undefined) {
        const a = path.segs[arriving];
        if (k === 0) anchor.twin = arriving;
        if (a.type === 'cubic' && !same(a.c2, point)) {
          anchor.handleIn = a.c2;
          anchor.inSeg = arriving;
        }
      }
      const leaving = k + 1 < sub.segs.length ? sub.segs[k + 1] : undefined;
      if (leaving !== undefined) {
        const l = path.segs[leaving];
        if (l.type === 'cubic' && !same(l.c1, point)) {
          anchor.handleOut = l.c1;
          anchor.outSeg = leaving;
        }
      }
      anchors.push(anchor);
    }
  }
  return anchors;
}

const add = (p: Point, d: Point): Point => ({ x: p.x + d.x, y: p.y + d.y });

function setEnd(s: Seg, p: Point): Seg {
  return s.type === 'close' ? s : { ...s, p };
}

/** Moves an anchor by `delta`; its handles move with it. */
export function moveAnchor(path: PathData, a: Anchor, delta: Point): PathData {
  const segs = [...path.segs];
  const shift = (i: number) => {
    const s = segs[i];
    if (s.type !== 'close') segs[i] = setEnd(s, add(s.p, delta));
  };
  // The handles touching the anchor move too, retracted ones included:
  // the arriving segments' second control points, the leaving one's first.
  for (const i of a.twin === undefined ? [a.seg] : [a.seg, a.twin]) {
    shift(i);
    const s = segs[i];
    if (s.type === 'cubic') segs[i] = { ...s, c2: add(s.c2, delta) };
  }
  const next = leavingSeg(path, a);
  if (next !== undefined) {
    const s = segs[next];
    if (s.type === 'cubic') segs[next] = { ...s, c1: add(s.c1, delta) };
  }
  return { segs };
}

/** The drawing segment after an anchor's, within its subpath. */
function leavingSeg(path: PathData, a: Anchor): number | undefined {
  const next = path.segs[a.seg + 1];
  return next && next.type !== 'move' && next.type !== 'close'
    ? a.seg + 1
    : undefined;
}

/**
 * Moves one handle of an anchor to `to`. A smooth point (its handles in
 * line) stays smooth unless `breakSmooth` (⌥): the other handle turns to
 * stay opposite, keeping its length.
 */
export function moveHandle(
  path: PathData,
  a: Anchor,
  side: 'in' | 'out',
  to: Point,
  breakSmooth: boolean
): PathData {
  const segs = [...path.segs];
  const own = side === 'in' ? a.inSeg : a.outSeg;
  if (own === undefined) return path;
  const s = segs[own];
  if (s.type !== 'cubic') return path;
  segs[own] = side === 'in' ? { ...s, c2: to } : { ...s, c1: to };
  const other = side === 'in' ? a.handleOut : a.handleIn;
  const otherSeg = side === 'in' ? a.outSeg : a.inSeg;
  const mine = side === 'in' ? a.handleIn : a.handleOut;
  if (breakSmooth || !other || otherSeg === undefined || !mine) return { segs };
  if (!isSmooth(a.point, mine, other)) return { segs };
  const length = Math.hypot(other.x - a.point.x, other.y - a.point.y);
  const dx = a.point.x - to.x;
  const dy = a.point.y - to.y;
  const d = Math.hypot(dx, dy);
  if (d < SAME) return { segs };
  const opposite = {
    x: a.point.x + (dx / d) * length,
    y: a.point.y + (dy / d) * length,
  };
  const o = segs[otherSeg];
  if (o.type === 'cubic')
    segs[otherSeg] =
      side === 'in' ? { ...o, c1: opposite } : { ...o, c2: opposite };
  return { segs };
}

/** Whether two handles of a point are in line through it (within ~2°). */
export function isSmooth(point: Point, a: Point, b: Point): boolean {
  const ax = a.x - point.x;
  const ay = a.y - point.y;
  const bx = b.x - point.x;
  const by = b.y - point.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < SAME || lb < SAME) return false;
  return (ax * bx + ay * by) / (la * lb) < -0.999;
}

/** A path mapped through a matrix. */
export function transformPath(path: PathData, m: Matrix): PathData {
  return {
    segs: path.segs.map((s) => {
      switch (s.type) {
        case 'move':
        case 'line':
          return { ...s, p: apply(m, s.p) };
        case 'cubic':
          return {
            type: 'cubic',
            c1: apply(m, s.c1),
            c2: apply(m, s.c2),
            p: apply(m, s.p),
          };
        case 'close':
          return s;
      }
    }),
  };
}

/** A pen click (a corner) or drag (a smooth point with mirrored handles). */
export interface PenPoint {
  p: Point;
  /** The handle leaving the point; the arriving one mirrors it. */
  out: Point | null;
}

const mirror = (p: Point, about: Point): Point => ({
  x: 2 * about.x - p.x,
  y: 2 * about.y - p.y,
});

function penSeg(from: PenPoint, to: PenPoint): Seg {
  if (!from.out && !to.out) return { type: 'line', p: to.p };
  return {
    type: 'cubic',
    c1: from.out ?? from.p,
    c2: to.out ? mirror(to.out, to.p) : to.p,
    p: to.p,
  };
}

/** The path the pen's points make, closed back to the first or open. */
export function penPath(
  points: readonly PenPoint[],
  closed: boolean
): PathData {
  if (points.length === 0) return { segs: [] };
  const segs: Seg[] = [{ type: 'move', p: points[0].p }];
  for (let i = 1; i < points.length; i++)
    segs.push(penSeg(points[i - 1], points[i]));
  if (closed && points.length > 1) {
    const back = penSeg(points[points.length - 1], points[0]);
    if (back.type === 'cubic') segs.push(back);
    segs.push({ type: 'close' });
  }
  return { segs };
}

/** Whether a press at `at` closes the pen's path on its first point. */
export function closesPen(
  points: readonly PenPoint[],
  at: Point,
  reach: number
): boolean {
  if (points.length < 2) return false;
  const first = points[0].p;
  return Math.hypot(at.x - first.x, at.y - first.y) <= reach;
}

/** The handle a pen drag pulls out (none for a short drag: a corner). */
export function penHandle(
  anchor: Point,
  at: Point,
  minimum: number
): Point | null {
  return Math.hypot(at.x - anchor.x, at.y - anchor.y) < minimum ? null : at;
}

/** The anchors a path's outline passes through, in canvas space. */
export function canvasAnchors(path: PathData, m: Matrix): Anchor[] {
  return anchorsOf(transformPath(path, m));
}
