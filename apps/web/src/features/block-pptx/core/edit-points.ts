/**
 * Edit Points, as in PowerPoint: a shape's outline as vertices joined by
 * straight or curved segments, and the edits made on it (moving vertices and
 * Bézier handles, bending segments, adding and deleting points, opening and
 * closing paths, and Smooth / Straight / Corner points). Pure functions over
 * an immutable model in shape-local points; every edit returns a new shape.
 */

import type {
  GeometryPath,
  PathCommand,
  PathFillMode,
} from '@core/pptx-engine/types';
import { type Affine, applyAffine, type Point } from './geometry';

/**
 * How a vertex treats its two handles: a smooth point keeps them opposite
 * and equally long, a straight point keeps them opposite, and a corner
 * point leaves them independent.
 */
export type NodeKind = 'smooth' | 'straight' | 'corner';

export interface EditNode {
  p: Point;
  kind: NodeKind;
}

/** A segment to the next vertex: straight, or a cubic with control points. */
export type EditSegment =
  | { curve: false }
  | { curve: true; c1: Point; c2: Point };

/**
 * One sub-path: segment `i` runs from vertex `i` to vertex `i + 1` (the last
 * segment of a closed sub-path back to vertex 0).
 */
export interface EditSubpath {
  nodes: EditNode[];
  segments: EditSegment[];
  closed: boolean;
}

/** One path of the outline: sub-paths filled together. */
export interface EditPath {
  subpaths: EditSubpath[];
  fill?: PathFillMode | null;
  stroke?: boolean | null;
}

export type EditShape = EditPath[];

export interface NodeRef {
  path: number;
  sub: number;
  node: number;
}

export interface SegmentRef {
  path: number;
  sub: number;
  seg: number;
}

export type HandleSide = 'in' | 'out';

/** Points closer than this (points) are the same vertex. */
const SAME = 0.01;

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const length = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => length(sub(a, b));

// ---- conversion ------------------------------------------------------------

/** The engine's paths (lines, cubic and quadratic curves) as an edit model. */
export function fromGeometry(paths: GeometryPath[]): EditShape {
  return paths.map((path) => {
    const subpaths: EditSubpath[] = [];
    let current: EditSubpath | null = null;
    let at: Point = { x: 0, y: 0 };
    const node = (p: Point): EditNode => ({ p, kind: 'corner' });
    const finish = (closed: boolean) => {
      if (!current) return;
      const c = current;
      const n = c.nodes.length;
      if (closed && n > 1 && dist(c.nodes[n - 1].p, c.nodes[0].p) < SAME) {
        // The last command came back to the start: that is the closing segment.
        c.nodes.pop();
        c.closed = true;
      } else if (closed && n > 1) {
        c.segments.push({ curve: false });
        c.closed = true;
      }
      if (c.nodes.length > 0) subpaths.push(c);
      current = null;
    };
    const ensure = (): EditSubpath => {
      if (!current)
        current = { nodes: [node(at)], segments: [], closed: false };
      return current;
    };
    for (const c of path.commands) {
      switch (c.cmd) {
        case 'moveTo':
          finish(false);
          at = { x: c.x, y: c.y };
          current = { nodes: [node(at)], segments: [], closed: false };
          break;
        case 'lineTo': {
          const s = ensure();
          at = { x: c.x, y: c.y };
          s.segments.push({ curve: false });
          s.nodes.push(node(at));
          break;
        }
        case 'cubicBezTo': {
          const s = ensure();
          s.segments.push({
            curve: true,
            c1: { x: c.x1, y: c.y1 },
            c2: { x: c.x2, y: c.y2 },
          });
          at = { x: c.x, y: c.y };
          s.nodes.push(node(at));
          break;
        }
        case 'quadBezTo': {
          // The same curve as a cubic.
          const s = ensure();
          const q = { x: c.x1, y: c.y1 };
          const end = { x: c.x, y: c.y };
          s.segments.push({
            curve: true,
            c1: lerp(at, q, 2 / 3),
            c2: lerp(end, q, 2 / 3),
          });
          at = end;
          s.nodes.push(node(at));
          break;
        }
        case 'arcTo':
          // The engine reads arcs as cubics; a bare arc keeps its end only.
          break;
        case 'close': {
          const start = current ? current.nodes[0].p : at;
          finish(true);
          at = start;
          break;
        }
      }
    }
    finish(false);
    return {
      subpaths: subpaths.map(inferKinds),
      fill: path.fill,
      stroke: path.stroke,
    };
  });
}

/** The edit model as the engine's paths. */
export function toGeometry(shape: EditShape): GeometryPath[] {
  return shape.map((path) => {
    const commands: PathCommand[] = [];
    for (const s of path.subpaths) {
      if (s.nodes.length === 0) continue;
      commands.push({ cmd: 'moveTo', ...xy(s.nodes[0].p) });
      s.segments.forEach((seg, i) => {
        const end = s.nodes[(i + 1) % s.nodes.length].p;
        const closing = s.closed && i === s.segments.length - 1;
        if (!seg.curve) {
          // `close` draws the closing line.
          if (!closing) commands.push({ cmd: 'lineTo', ...xy(end) });
          return;
        }
        commands.push({
          cmd: 'cubicBezTo',
          x1: seg.c1.x,
          y1: seg.c1.y,
          x2: seg.c2.x,
          y2: seg.c2.y,
          ...xy(end),
        });
      });
      if (s.closed) commands.push({ cmd: 'close' });
    }
    return { commands, fill: path.fill ?? null, stroke: path.stroke ?? null };
  });
}

const xy = (p: Point) => ({ x: p.x, y: p.y });

// ---- structure -------------------------------------------------------------

/** The index of the segment ending at vertex `i`, if any. */
export function incoming(s: EditSubpath, i: number): number | undefined {
  if (i > 0) return i - 1;
  return s.closed ? s.segments.length - 1 : undefined;
}

/** The index of the segment starting at vertex `i`, if any. */
export function outgoing(s: EditSubpath, i: number): number | undefined {
  return i < s.segments.length ? i : undefined;
}

/** The end vertex of segment `k`. */
const endOf = (s: EditSubpath, k: number) => (k + 1) % s.nodes.length;

/** The four Bézier points of a segment (a line's controls lie on it). */
export function segmentPoints(
  s: EditSubpath,
  k: number
): [Point, Point, Point, Point] {
  const p0 = s.nodes[k].p;
  const p3 = s.nodes[endOf(s, k)].p;
  const seg = s.segments[k];
  return seg.curve
    ? [p0, seg.c1, seg.c2, p3]
    : [p0, lerp(p0, p3, 1 / 3), lerp(p0, p3, 2 / 3), p3];
}

/** The point at `t` on a cubic. */
export function cubicAt(
  [p0, p1, p2, p3]: [Point, Point, Point, Point],
  t: number
): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * Where a vertex's handles are: the control points of its curved
 * segments, or a third of the way along a straight one (dragging such a
 * handle bends the segment, as in PowerPoint).
 */
export function handles(
  s: EditSubpath,
  i: number
): { side: HandleSide; at: Point }[] {
  const out: { side: HandleSide; at: Point }[] = [];
  const k = incoming(s, i);
  if (k !== undefined) out.push({ side: 'in', at: segmentPoints(s, k)[2] });
  const m = outgoing(s, i);
  if (m !== undefined) out.push({ side: 'out', at: segmentPoints(s, m)[1] });
  return out;
}

/** Replaces one sub-path of a shape. */
function withSubpath(
  shape: EditShape,
  path: number,
  subIndex: number,
  next: EditSubpath | null
): EditShape {
  return shape.map((p, pi) =>
    pi !== path
      ? p
      : {
          ...p,
          subpaths: p.subpaths.flatMap((s, si) =>
            si !== subIndex ? [s] : next ? [next] : []
          ),
        }
  );
}

function subpathOf(shape: EditShape, ref: { path: number; sub: number }) {
  return shape[ref.path]?.subpaths[ref.sub];
}

/** A copy with the segment turned into a curve (a line keeps its course). */
function curved(s: EditSubpath, k: number): EditSubpath {
  if (s.segments[k].curve) return s;
  const [, c1, c2] = segmentPoints(s, k);
  const segments = s.segments.slice();
  segments[k] = { curve: true, c1, c2 };
  return { ...s, segments };
}

function setControl(
  s: EditSubpath,
  k: number,
  which: 'c1' | 'c2',
  at: Point
): EditSubpath {
  const c = curved(s, k);
  const seg = c.segments[k];
  if (!seg.curve) return c;
  const segments = c.segments.slice();
  segments[k] = { ...seg, [which]: at };
  return { ...c, segments };
}

/** The handle of vertex `i` on `side`, if it has one. */
function handleAt(s: EditSubpath, i: number, side: HandleSide) {
  return handles(s, i).find((h) => h.side === side)?.at;
}

function setHandle(
  s: EditSubpath,
  i: number,
  side: HandleSide,
  at: Point
): EditSubpath {
  const k = side === 'in' ? incoming(s, i) : outgoing(s, i);
  if (k === undefined) return s;
  return setControl(s, k, side === 'in' ? 'c2' : 'c1', at);
}

/**
 * Keeps a smooth or straight vertex's other handle opposite the one just
 * set on `side` (equally long for a smooth point).
 */
function constrain(s: EditSubpath, i: number, side: HandleSide): EditSubpath {
  const node = s.nodes[i];
  if (node.kind === 'corner') return s;
  const other: HandleSide = side === 'in' ? 'out' : 'in';
  const moved = handleAt(s, i, side);
  const current = handleAt(s, i, other);
  if (!moved || !current) return s;
  const d = sub(node.p, moved);
  const len = length(d);
  if (len < 1e-9) return s;
  const keep = node.kind === 'smooth' ? len : length(sub(current, node.p));
  return setHandle(s, i, other, add(node.p, scale(d, keep / len)));
}

// ---- edits -----------------------------------------------------------------

/** Moves a vertex (its handles move with it). */
export function moveNode(shape: EditShape, ref: NodeRef, to: Point): EditShape {
  const s = subpathOf(shape, ref);
  if (!s) return shape;
  const d = sub(to, s.nodes[ref.node].p);
  const nodes = s.nodes.slice();
  nodes[ref.node] = { ...nodes[ref.node], p: to };
  const segments = s.segments.slice();
  const k = incoming(s, ref.node);
  const m = outgoing(s, ref.node);
  if (k !== undefined) {
    const seg = segments[k];
    if (seg.curve) segments[k] = { ...seg, c2: add(seg.c2, d) };
  }
  if (m !== undefined) {
    const seg = segments[m];
    if (seg.curve) segments[m] = { ...seg, c1: add(seg.c1, d) };
  }
  return withSubpath(shape, ref.path, ref.sub, { ...s, nodes, segments });
}

/** Drags one of a vertex's handles; a smooth or straight vertex keeps its shape. */
export function moveHandle(
  shape: EditShape,
  ref: NodeRef,
  side: HandleSide,
  to: Point
): EditShape {
  const s = subpathOf(shape, ref);
  if (!s) return shape;
  const next = constrain(setHandle(s, ref.node, side, to), ref.node, side);
  return withSubpath(shape, ref.path, ref.sub, next);
}

/**
 * Bends a segment so its point at `t` (where it was grabbed) moves by
 * `delta`: the smallest change of its two control points that does it.
 * Smooth and straight vertices at its ends turn their other handles along.
 */
export function bendSegment(
  shape: EditShape,
  ref: SegmentRef,
  t: number,
  delta: Point
): EditShape {
  const s = subpathOf(shape, ref);
  if (!s) return shape;
  const tt = Math.min(0.95, Math.max(0.05, t));
  const b1 = 3 * (1 - tt) * (1 - tt) * tt;
  const b2 = 3 * (1 - tt) * tt * tt;
  const norm = b1 * b1 + b2 * b2;
  const [, c1, c2] = segmentPoints(s, ref.seg);
  let next = setControl(s, ref.seg, 'c1', add(c1, scale(delta, b1 / norm)));
  next = setControl(next, ref.seg, 'c2', add(c2, scale(delta, b2 / norm)));
  next = constrain(next, ref.seg, 'out');
  next = constrain(next, endOf(next, ref.seg), 'in');
  return withSubpath(shape, ref.path, ref.sub, next);
}

/** Splits segment `k` of a cubic at `t`. */
function splitCubic(
  pts: [Point, Point, Point, Point],
  t: number
): [[Point, Point, Point, Point], [Point, Point, Point, Point]] {
  const [p0, p1, p2, p3] = pts;
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const m = lerp(d, e, t);
  return [
    [p0, a, d, m],
    [m, e, c, p3],
  ];
}

/**
 * Adds a vertex on a segment at `t` (the outline does not change); returns
 * the new shape and the new vertex.
 */
export function addNode(
  shape: EditShape,
  ref: SegmentRef,
  t: number
): { shape: EditShape; node: NodeRef } {
  const s = subpathOf(shape, ref);
  const node = { path: ref.path, sub: ref.sub, node: ref.seg + 1 };
  if (!s) return { shape, node };
  const seg = s.segments[ref.seg];
  const pts = segmentPoints(s, ref.seg);
  const tt = Math.min(0.999, Math.max(0.001, t));
  const nodes = s.nodes.slice();
  const segments = s.segments.slice();
  if (seg.curve) {
    const [a, b] = splitCubic(pts, tt);
    nodes.splice(ref.seg + 1, 0, { p: a[3], kind: 'smooth' });
    segments.splice(
      ref.seg,
      1,
      { curve: true, c1: a[1], c2: a[2] },
      { curve: true, c1: b[1], c2: b[2] }
    );
  } else {
    nodes.splice(ref.seg + 1, 0, {
      p: lerp(pts[0], pts[3], tt),
      kind: 'corner',
    });
    segments.splice(ref.seg, 1, { curve: false }, { curve: false });
  }
  return {
    shape: withSubpath(shape, ref.path, ref.sub, { ...s, nodes, segments }),
    node,
  };
}

/** How many vertices the whole outline has. */
export function nodeCount(shape: EditShape): number {
  return shape.reduce(
    (n, p) => n + p.subpaths.reduce((m, s) => m + s.nodes.length, 0),
    0
  );
}

/**
 * Deletes a vertex, joining its two segments into one (a curve if either
 * was curved). A sub-path left with one vertex goes; `null` when that would
 * leave the shape without an outline.
 */
export function deleteNode(shape: EditShape, ref: NodeRef): EditShape | null {
  const s = subpathOf(shape, ref);
  if (!s) return shape;
  const i = ref.node;
  const n = s.nodes.length;
  if (n <= 2) {
    const next = withSubpath(shape, ref.path, ref.sub, null).filter(
      (p) => p.subpaths.length > 0
    );
    return next.length > 0 ? next : null;
  }
  const nodes = s.nodes.filter((_, j) => j !== i);
  let segments = s.segments.slice();
  const k = incoming(s, i);
  const m = outgoing(s, i);
  if (k === undefined || m === undefined) {
    // An end of an open sub-path: drop its one segment.
    segments.splice(k === undefined ? 0 : k, 1);
  } else {
    const a = s.segments[k];
    const b = s.segments[m];
    const joined: EditSegment =
      a.curve || b.curve
        ? {
            curve: true,
            c1: segmentPoints(s, k)[1],
            c2: segmentPoints(s, m)[2],
          }
        : { curve: false };
    if (m === 0) {
      // Vertex 0 of a closed sub-path: the closing segment takes over.
      segments = segments.slice(1);
      segments[segments.length - 1] = joined;
    } else {
      segments.splice(k, 2, joined);
    }
  }
  return withSubpath(shape, ref.path, ref.sub, { ...s, nodes, segments });
}

/**
 * Opens a closed sub-path at a vertex, which becomes both its start and
 * its end (PowerPoint's Open Path).
 */
export function openAt(shape: EditShape, ref: NodeRef): EditShape {
  const s = subpathOf(shape, ref);
  if (!s?.closed) return shape;
  const i = ref.node;
  const nodes = [...s.nodes.slice(i), ...s.nodes.slice(0, i)];
  const segments = [...s.segments.slice(i), ...s.segments.slice(0, i)];
  nodes.push({ ...s.nodes[i], kind: 'corner' });
  nodes[0] = { ...nodes[0], kind: 'corner' };
  return withSubpath(shape, ref.path, ref.sub, {
    nodes,
    segments,
    closed: false,
  });
}

/**
 * Closes an open sub-path (PowerPoint's Close Path): ends that meet are
 * joined, otherwise a straight segment joins them.
 */
export function closeSubpath(
  shape: EditShape,
  ref: { path: number; sub: number }
): EditShape {
  const s = subpathOf(shape, ref);
  if (!s || s.closed || s.nodes.length < 2) return shape;
  const n = s.nodes.length;
  if (dist(s.nodes[0].p, s.nodes[n - 1].p) < SAME && n > 2) {
    return withSubpath(shape, ref.path, ref.sub, {
      nodes: s.nodes.slice(0, n - 1),
      segments: s.segments.slice(),
      closed: true,
    });
  }
  return withSubpath(shape, ref.path, ref.sub, {
    nodes: s.nodes.slice(),
    segments: [...s.segments, { curve: false }],
    closed: true,
  });
}

/**
 * Deletes a segment: a closed sub-path opens there; an open one splits in
 * two (or loses an end segment).
 */
export function deleteSegment(
  shape: EditShape,
  ref: SegmentRef
): EditShape | null {
  const s = subpathOf(shape, ref);
  if (!s) return shape;
  const k = ref.seg;
  if (s.closed) {
    const start = endOf(s, k);
    const nodes = [...s.nodes.slice(start), ...s.nodes.slice(0, start)];
    const segments = [
      ...s.segments.slice(start),
      ...s.segments.slice(0, start),
    ].slice(0, s.nodes.length - 1);
    return withSubpath(shape, ref.path, ref.sub, {
      nodes: nodes.map((x, j) =>
        j === 0 || j === nodes.length - 1 ? { ...x, kind: 'corner' } : x
      ),
      segments,
      closed: false,
    });
  }
  const head: EditSubpath = {
    nodes: s.nodes.slice(0, k + 1),
    segments: s.segments.slice(0, k),
    closed: false,
  };
  const tail: EditSubpath = {
    nodes: s.nodes.slice(k + 1),
    segments: s.segments.slice(k + 1),
    closed: false,
  };
  const keep = [head, tail].filter((x) => x.nodes.length > 1);
  const next = shape
    .map((p, pi) =>
      pi !== ref.path
        ? p
        : {
            ...p,
            subpaths: p.subpaths.flatMap((x, si) =>
              si !== ref.sub ? [x] : keep
            ),
          }
    )
    .filter((p) => p.subpaths.length > 0);
  return next.length > 0 ? next : null;
}

/** Makes a segment straight or curved (a new curve keeps the line's course). */
export function setSegmentCurved(
  shape: EditShape,
  ref: SegmentRef,
  curve: boolean
): EditShape {
  const s = subpathOf(shape, ref);
  if (!s) return shape;
  if (curve) return withSubpath(shape, ref.path, ref.sub, curved(s, ref.seg));
  const segments = s.segments.slice();
  segments[ref.seg] = { curve: false };
  return withSubpath(shape, ref.path, ref.sub, { ...s, segments });
}

/**
 * Makes a vertex Smooth (handles opposite and equally long), Straight
 * (opposite, lengths kept), or Corner (independent; the outline stays).
 * Straight segments at a smooth or straight vertex become curves.
 */
export function setNodeKind(
  shape: EditShape,
  ref: NodeRef,
  kind: NodeKind
): EditShape {
  let s = subpathOf(shape, ref);
  if (!s) return shape;
  const i = ref.node;
  const nodes = s.nodes.slice();
  nodes[i] = { ...nodes[i], kind };
  s = { ...s, nodes };
  const k = incoming(s, i);
  const m = outgoing(s, i);
  if (kind !== 'corner' && k !== undefined && m !== undefined) {
    s = curved(curved(s, k), m);
    const p = s.nodes[i].p;
    const hin = segmentPoints(s, k)[2];
    const hout = segmentPoints(s, m)[1];
    let dir = sub(hout, hin);
    if (length(dir) < 1e-9) dir = sub(s.nodes[endOf(s, m)].p, s.nodes[k].p);
    const dl = length(dir);
    if (dl > 1e-9) {
      const u = scale(dir, 1 / dl);
      const lin = length(sub(p, hin));
      const lout = length(sub(hout, p));
      const avg = (lin + lout) / 2;
      const [a, b] = kind === 'smooth' ? [avg, avg] : [lin, lout];
      s = setHandle(s, i, 'in', sub(p, scale(u, a)));
      s = setHandle(s, i, 'out', add(p, scale(u, b)));
    }
  }
  return withSubpath(shape, ref.path, ref.sub, s);
}

/**
 * What each vertex looks like it is, from its handles: Smooth when they
 * are opposite and equally long, Straight when only opposite, else Corner.
 */
export function inferKinds(s: EditSubpath): EditSubpath {
  return {
    ...s,
    nodes: s.nodes.map((node, i) => {
      const k = incoming(s, i);
      const m = outgoing(s, i);
      if (k === undefined || m === undefined)
        return { ...node, kind: 'corner' };
      if (!s.segments[k].curve || !s.segments[m].curve)
        return { ...node, kind: 'corner' };
      const a = sub(node.p, segmentPoints(s, k)[2]);
      const b = sub(segmentPoints(s, m)[1], node.p);
      const la = length(a);
      const lb = length(b);
      if (la < 1e-6 || lb < 1e-6) return { ...node, kind: 'corner' };
      const cross = (a.x * b.y - a.y * b.x) / (la * lb);
      const dot = (a.x * b.x + a.y * b.y) / (la * lb);
      if (Math.abs(cross) > 0.01 || dot < 0) return { ...node, kind: 'corner' };
      return {
        ...node,
        kind:
          Math.abs(la - lb) < 0.01 * Math.max(la, lb) ? 'smooth' : 'straight',
      };
    }),
  };
}

/** Keeps vertex kinds from `before` where the structure is the same. */
export function keepKinds(before: EditShape, after: EditShape): EditShape {
  return after.map((p, pi) => ({
    ...p,
    subpaths: p.subpaths.map((s, si) => {
      const old = before[pi]?.subpaths[si];
      if (!old || old.nodes.length !== s.nodes.length) return s;
      return {
        ...s,
        nodes: s.nodes.map((n, i) => ({ ...n, kind: old.nodes[i].kind })),
      };
    }),
  }));
}

// ---- hit testing and drawing ----------------------------------------------

/** The vertex nearest `at` (screen pixels) within `radius`. */
export function hitNode(
  shape: EditShape,
  toScreen: Affine,
  at: Point,
  radius: number
): NodeRef | undefined {
  let best: { ref: NodeRef; d: number } | undefined;
  shape.forEach((p, path) =>
    p.subpaths.forEach((s, si) =>
      s.nodes.forEach((n, node) => {
        const d = dist(applyAffine(toScreen, n.p), at);
        if (d <= radius && (!best || d < best.d))
          best = { ref: { path, sub: si, node }, d };
      })
    )
  );
  return best?.ref;
}

/** Which handle of vertex `ref` is at `at` (screen pixels), if any. */
export function hitHandle(
  shape: EditShape,
  ref: NodeRef,
  toScreen: Affine,
  at: Point,
  radius: number
): HandleSide | undefined {
  const s = subpathOf(shape, ref);
  if (!s) return undefined;
  let best: { side: HandleSide; d: number } | undefined;
  for (const h of handles(s, ref.node)) {
    const d = dist(applyAffine(toScreen, h.at), at);
    if (d <= radius && (!best || d < best.d)) best = { side: h.side, d };
  }
  return best?.side;
}

const SAMPLES = 48;

/**
 * The segment passing nearest `at` (screen pixels) within `radius`, and
 * where on it (`t`).
 */
export function hitSegment(
  shape: EditShape,
  toScreen: Affine,
  at: Point,
  radius: number
): { ref: SegmentRef; t: number } | undefined {
  let best: { ref: SegmentRef; t: number; d: number } | undefined;
  shape.forEach((p, path) =>
    p.subpaths.forEach((s, si) =>
      s.segments.forEach((_, seg) => {
        const pts = segmentPoints(s, seg).map((q) =>
          applyAffine(toScreen, q)
        ) as [Point, Point, Point, Point];
        let prev = pts[0];
        for (let i = 1; i <= SAMPLES; i++) {
          const t1 = i / SAMPLES;
          const q = cubicAt(pts, t1);
          // Nearest point on the chord from prev to q.
          const v = sub(q, prev);
          const len2 = v.x * v.x + v.y * v.y;
          const u =
            len2 > 0
              ? Math.min(
                  1,
                  Math.max(
                    0,
                    ((at.x - prev.x) * v.x + (at.y - prev.y) * v.y) / len2
                  )
                )
              : 0;
          const d = dist(lerp(prev, q, u), at);
          if (d <= radius && (!best || d < best.d))
            best = {
              ref: { path, sub: si, seg },
              t: (i - 1 + u) / SAMPLES,
              d,
            };
          prev = q;
        }
      })
    )
  );
  return best && { ref: best.ref, t: best.t };
}

/** SVG path data of the outline mapped through `t` (e.g. to screen pixels). */
export function pathData(shape: EditShape, t: Affine): string {
  const f = (p: Point) => {
    const q = applyAffine(t, p);
    return `${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
  };
  const parts: string[] = [];
  for (const p of shape) {
    for (const s of p.subpaths) {
      if (s.nodes.length === 0) continue;
      parts.push(`M${f(s.nodes[0].p)}`);
      s.segments.forEach((seg, k) => {
        const end = s.nodes[endOf(s, k)].p;
        parts.push(
          seg.curve ? `C${f(seg.c1)} ${f(seg.c2)} ${f(end)}` : `L${f(end)}`
        );
      });
      if (s.closed) parts.push('Z');
    }
  }
  return parts.join(' ');
}

/** Whether two shapes have the same vertices and segments. */
export function sameShape(a: EditShape, b: EditShape): boolean {
  return JSON.stringify(toGeometry(a)) === JSON.stringify(toGeometry(b));
}

/** Every vertex of the outline, for drawing. */
export function allNodes(shape: EditShape): { ref: NodeRef; p: Point }[] {
  return shape.flatMap((p, path) =>
    p.subpaths.flatMap((s, si) =>
      s.nodes.map((n, node) => ({ ref: { path, sub: si, node }, p: n.p }))
    )
  );
}

/** A vertex by reference. */
export function nodeAt(shape: EditShape, ref: NodeRef): EditNode | undefined {
  return subpathOf(shape, ref)?.nodes[ref.node];
}

/** Whether a reference's sub-path is closed. */
export function isClosed(
  shape: EditShape,
  ref: { path: number; sub: number }
): boolean {
  return !!subpathOf(shape, ref)?.closed;
}

/** Whether a segment is curved. */
export function isCurved(shape: EditShape, ref: SegmentRef): boolean {
  return !!subpathOf(shape, ref)?.segments[ref.seg]?.curve;
}

/** The segments ending and starting at a vertex, as references. */
export function segmentsAt(shape: EditShape, ref: NodeRef): SegmentRef[] {
  const s = subpathOf(shape, ref);
  if (!s) return [];
  return [incoming(s, ref.node), outgoing(s, ref.node)]
    .filter((k): k is number => k !== undefined)
    .map((seg) => ({ path: ref.path, sub: ref.sub, seg }));
}
