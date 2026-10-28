/**
 * Vector networks as the pen tool draws them and vector editing changes
 * them, in page coordinates (the engine fits the layer to the result).
 *
 * A pen point is a vertex with an outgoing handle (relative to it); the
 * incoming handle mirrors it, as Figma's pen makes smooth points when you
 * drag. A corner point has no handle.
 */

import type {
  NodeType,
  Vec2,
  VectorNetwork,
  VectorSegment,
} from '@core/fig-engine/types';

/** Layers whose points Enter or a double-click edits (shapes become
 * vectors when their points change, as in Figma). */
export const VECTOR_EDITABLE: ReadonlySet<NodeType> = new Set<NodeType>([
  'VECTOR',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'STAR',
  'REGULAR_POLYGON',
  'LINE',
]);

export interface PenPoint {
  x: number;
  y: number;
  /** Outgoing handle, relative to the point; zero for a corner. */
  handle: Vec2;
}

const ZERO: Vec2 = { x: 0, y: 0 };

const neg = (v: Vec2): Vec2 => ({ x: -v.x || 0, y: -v.y || 0 });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The network a pen path draws: its points joined in order, and back to
 * the first when `closed` (a closed path is one filled region).
 */
export function penNetwork(points: PenPoint[], closed: boolean): VectorNetwork {
  const segment = (a: number, b: number): VectorSegment => ({
    start: a,
    end: b,
    tangentStart: { ...points[a].handle },
    tangentEnd: neg(points[b].handle),
  });
  const segments: VectorSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) segments.push(segment(i, i + 1));
  const close = closed && points.length > 2;
  if (close) segments.push(segment(points.length - 1, 0));
  return {
    vertices: points.map((p) => ({ x: p.x, y: p.y })),
    segments,
    regions: close
      ? [{ windingRule: 'NONZERO', loops: [segments.map((_, i) => i)] }]
      : [],
  };
}

/** Whether a press at `p` closes the path: on its first point. */
export function closesPath(
  points: PenPoint[],
  p: Vec2,
  tolerance: number
): boolean {
  return points.length > 2 && dist(points[0], p) <= tolerance;
}

/**
 * Whether a pen press at `p` lands on the last point placed (the second
 * press of a double-click, say), which ends the path open instead of
 * adding the same point again.
 */
export function endsPath(
  points: PenPoint[],
  p: Vec2,
  tolerance: number
): boolean {
  const last = points.at(-1);
  return !!last && dist(last, p) <= tolerance;
}

/** The handle a drag from `from` to `to` gives a new pen point. */
export function dragHandle(from: Vec2, to: Vec2, minimum: number): Vec2 {
  return dist(from, to) < minimum
    ? ZERO
    : { x: to.x - from.x, y: to.y - from.y };
}

/** The cubic a segment draws: start, two control points, end. */
export function segmentCurve(
  net: VectorNetwork,
  s: VectorSegment
): [Vec2, Vec2, Vec2, Vec2] {
  const a = net.vertices[s.start];
  const b = net.vertices[s.end];
  return [
    { x: a.x, y: a.y },
    { x: a.x + s.tangentStart.x, y: a.y + s.tangentStart.y },
    { x: b.x + s.tangentEnd.x, y: b.y + s.tangentEnd.y },
    { x: b.x, y: b.y },
  ];
}

const isZero = (v: Vec2) => v.x === 0 && v.y === 0;

/** A handle: the end of a segment at a vertex. */
export interface HandleRef {
  segment: number;
  end: 'start' | 'end';
}

/** The handles at vertex `i` (curved segment ends), with their positions. */
export function vertexHandles(
  net: VectorNetwork,
  i: number
): (HandleRef & { at: Vec2 })[] {
  const v = net.vertices[i];
  const out: (HandleRef & { at: Vec2 })[] = [];
  net.segments.forEach((s, k) => {
    if (s.start === i && !isZero(s.tangentStart))
      out.push({
        segment: k,
        end: 'start',
        at: { x: v.x + s.tangentStart.x, y: v.y + s.tangentStart.y },
      });
    if (s.end === i && !isZero(s.tangentEnd))
      out.push({
        segment: k,
        end: 'end',
        at: { x: v.x + s.tangentEnd.x, y: v.y + s.tangentEnd.y },
      });
  });
  return out;
}

export type VectorHit =
  | { kind: 'vertex'; index: number }
  | ({ kind: 'handle' } & HandleRef);

/**
 * What a press at `p` takes: a handle of the selected vertex first, then the
 * nearest vertex within `tolerance` (page units).
 */
export function hitVector(
  net: VectorNetwork,
  p: Vec2,
  tolerance: number,
  selected?: number
): VectorHit | undefined {
  if (selected !== undefined && net.vertices[selected]) {
    const handle = vertexHandles(net, selected).find(
      (h) => dist(h.at, p) <= tolerance
    );
    if (handle)
      return { kind: 'handle', segment: handle.segment, end: handle.end };
  }
  let best: number | undefined;
  let bestDistance = tolerance;
  net.vertices.forEach((v, i) => {
    const d = dist(v, p);
    if (d <= bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best === undefined ? undefined : { kind: 'vertex', index: best };
}

/** The network with vertex `i` at `to` (its handles move with it). */
export function moveVertex(
  net: VectorNetwork,
  i: number,
  to: Vec2
): VectorNetwork {
  return {
    ...net,
    vertices: net.vertices.map((v, k) =>
      k === i ? { ...v, x: to.x, y: to.y } : v
    ),
  };
}

/**
 * The network with a handle dragged to `to` (page point). When `mirror`,
 * handles at the same vertex that mirrored it keep mirroring it.
 */
export function moveHandle(
  net: VectorNetwork,
  handle: HandleRef,
  to: Vec2,
  mirror: boolean
): VectorNetwork {
  const seg = net.segments[handle.segment];
  if (!seg) return net;
  const vertex = handle.end === 'start' ? seg.start : seg.end;
  const v = net.vertices[vertex];
  const old = handle.end === 'start' ? seg.tangentStart : seg.tangentEnd;
  const next = { x: to.x - v.x, y: to.y - v.y };
  const mirrored = (t: Vec2) =>
    !isZero(t) &&
    Math.abs(t.x + old.x) < 1e-3 * (1 + Math.abs(old.x)) &&
    Math.abs(t.y + old.y) < 1e-3 * (1 + Math.abs(old.y));
  const segments = net.segments.map((s, k) => {
    let out = s;
    if (k === handle.segment) {
      out =
        handle.end === 'start'
          ? { ...out, tangentStart: next }
          : { ...out, tangentEnd: next };
    } else if (mirror) {
      if (s.start === vertex && mirrored(s.tangentStart))
        out = { ...out, tangentStart: neg(next) };
      if (s.end === vertex && mirrored(s.tangentEnd))
        out = { ...out, tangentEnd: neg(next) };
    }
    return out;
  });
  return { ...net, segments };
}

/** The network without vertex `i`, its segments, and loops through them. */
export function deleteVertex(net: VectorNetwork, i: number): VectorNetwork {
  const keep = net.segments.map((s) => s.start !== i && s.end !== i);
  const newIndex: number[] = [];
  let n = 0;
  keep.forEach((k, at) => {
    newIndex[at] = k ? n++ : -1;
  });
  const shift = (v: number) => (v > i ? v - 1 : v);
  return {
    vertices: net.vertices.filter((_, k) => k !== i),
    segments: net.segments
      .filter((_, k) => keep[k])
      .map((s) => ({ ...s, start: shift(s.start), end: shift(s.end) })),
    regions: net.regions
      .map((r) => ({
        ...r,
        loops: r.loops
          .filter((l) => l.every((s) => keep[s]))
          .map((l) => l.map((s) => newIndex[s])),
      }))
      .filter((r) => r.loops.length > 0),
  };
}

/** Distance from `p` to the segment `a`–`b`. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)
        );
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** The points a stroke keeps within `tolerance` (Douglas–Peucker). */
function simplify(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    let farthest = -1;
    let distance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance(points[i], points[from], points[to]);
      if (d > distance) {
        distance = d;
        farthest = i;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = true;
    stack.push([from, farthest], [farthest, to]);
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * A pencil stroke as pen points: the points it passes through, fewer where
 * it runs straight, joined by smooth curves (the ends are corners).
 */
export function pencilPoints(stroke: Vec2[], tolerance: number): PenPoint[] {
  const points = simplify(stroke, tolerance);
  return points.map((p, i) => {
    const before = points[i - 1];
    const after = points[i + 1];
    const handle =
      before && after
        ? { x: (after.x - before.x) / 6, y: (after.y - before.y) / 6 }
        : ZERO;
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      x: round(p.x),
      y: round(p.y),
      handle: { x: round(handle.x), y: round(handle.y) },
    };
  });
}
