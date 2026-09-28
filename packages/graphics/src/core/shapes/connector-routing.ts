import { enclosing } from '../affine';
import type { Point } from '../model';

export type ConnectorRoute = 'straight' | 'stepped' | 'smooth';
export type ConnectorHead =
  | 'none'
  | 'arrow'
  | 'arrow-filled'
  | 'circle'
  | 'circle-small';
export type RouteEnd = Readonly<{ point: Point; direction?: Point }>;
export type CurveSegment = Readonly<{
  from: Point;
  to: Point;
  controls?: readonly [Point, Point];
}>;
export const add = (a: Point, b: Point): Point => ({
  x: a.x + b.x,
  y: a.y + b.y,
});
export const sub = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
export const times = (p: Point, k: number): Point => ({
  x: p.x * k,
  y: p.y * k,
});
export const length = (p: Point) => Math.hypot(p.x, p.y);
export const unit = (p: Point): Point =>
  length(p) > 1e-9 ? times(p, 1 / length(p)) : { x: 1, y: 0 };
const mid = (a: Point, b: Point) => times(add(a, b), 0.5);
const horizontal = (p: Point) => Math.abs(p.x) > Math.abs(p.y) + 1e-6;
const cardinal = (p: Point): Point =>
  horizontal(p)
    ? { x: Math.sign(p.x) || 1, y: 0 }
    : { x: 0, y: Math.sign(p.y) || 1 };
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

/** Ported from the original Canvas getRectilinearPoints: same 36-unit leads,
 * facing / parallel / perpendicular cases, and forward-ray intersection. */
function orthogonal(a: Point, b: Point, aDir: Point, bDir: Point): Point[] {
  const aNext = add(a, times(aDir, 36)),
    bNext = add(b, times(bDir, 36));
  const dot = aDir.x * bDir.x + aDir.y * bDir.y,
    h = horizontal(aDir);
  if (Math.abs(dot) < 1e-6) {
    const delta = sub(b, a),
      denominator = cross(aDir, bDir);
    const t = cross(delta, bDir) / denominator,
      u = cross(delta, aDir) / denominator;
    if (t >= 0 && u >= 0) return [a, add(a, times(aDir, t)), b];
    return [
      a,
      aNext,
      h ? { x: aNext.x, y: bNext.y } : { x: bNext.x, y: aNext.y },
      bNext,
      b,
    ];
  }
  const delta = sub(bNext, aNext),
    aligned = h
      ? Math.sign(aDir.x) === Math.sign(delta.x)
      : Math.sign(aDir.y) === Math.sign(delta.y);
  if (dot < 0) {
    if (aligned) {
      const m = mid(a, b);
      return [
        a,
        h ? { x: m.x, y: a.y } : { x: a.x, y: m.y },
        h ? { x: m.x, y: b.y } : { x: b.x, y: m.y },
        b,
      ];
    }
    const m = mid(aNext, bNext);
    return [
      a,
      aNext,
      h ? { x: aNext.x, y: m.y } : { x: m.x, y: aNext.y },
      h ? { x: bNext.x, y: m.y } : { x: m.x, y: bNext.y },
      bNext,
      b,
    ];
  }
  return aligned
    ? [a, h ? { x: bNext.x, y: a.y } : { x: a.x, y: bNext.y }, bNext, b]
    : [a, aNext, h ? { x: aNext.x, y: b.y } : { x: b.x, y: aNext.y }, bNext, b];
}
function steppedPoints(a: Point, b: Point, from: Point, to: Point) {
  const af = cardinal(from),
    bt = cardinal(to);
  // Preserve normal leads on rotated/nested shapes before joining the rectilinear route.
  const rotated = length(sub(from, af)) > 1e-6 || length(sub(to, bt)) > 1e-6;
  const points = rotated
    ? [
        a,
        ...orthogonal(add(a, times(from, 36)), add(b, times(to, 36)), af, bt),
        b,
      ]
    : orthogonal(a, b, af, bt);
  const merged: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++)
    if (length(sub(points[i]!, merged[merged.length - 1]!)) > 5)
      merged.push(points[i]!);
  // Retain the true endpoint even when it is within the old merge threshold.
  merged.push(b);
  return merged;
}
function rounded(points: readonly Point[]): CurveSegment[] {
  const segments: CurveSegment[] = [];
  let current = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i]!,
      v1 = sub(corner, points[i - 1]!),
      v2 = sub(points[i + 1]!, corner);
    const radius = Math.min(10, length(v1) / 2, length(v2) / 2);
    const start = sub(corner, times(unit(v1), radius)),
      end = add(corner, times(unit(v2), radius));
    segments.push(
      { from: current, to: start },
      {
        from: start,
        to: end,
        controls: [
          add(start, times(unit(v1), radius * 0.55)),
          sub(end, times(unit(v2), radius * 0.55)),
        ],
      }
    );
    current = end;
  }
  segments.push({ from: current, to: points[points.length - 1]! });
  return segments;
}
const pair = (p: Point) => `${p.x} ${p.y}`;
export function connectorPath(
  start: RouteEnd,
  end: RouteEnd,
  route: ConnectorRoute
) {
  const a = start.point,
    b = end.point,
    delta = sub(b, a),
    forward = unit(delta);
  const from =
    route === 'straight' ? forward : unit(start.direction ?? cardinal(forward));
  const to =
    route === 'straight'
      ? times(forward, -1)
      : unit(end.direction ?? times(cardinal(forward), -1));
  const strength = Math.max(1, Math.min(200, length(delta) / 2));
  const segments: readonly CurveSegment[] =
    route === 'straight'
      ? [{ from: a, to: b }]
      : route === 'smooth'
        ? [
            {
              from: a,
              to: b,
              controls: [
                add(a, times(from, strength)),
                add(b, times(to, strength)),
              ],
            },
          ]
        : rounded(steppedPoints(a, b, from, to));
  const path = `M ${pair(a)} ${segments.map((s) => (s.controls ? `C ${pair(s.controls[0])} ${pair(s.controls[1])} ${pair(s.to)}` : `L ${pair(s.to)}`)).join(' ')}`;
  // Convex hull bounds enclose curves. Samples follow the actual rounded path for picking.
  const bounds = enclosing(
    segments.flatMap((s) => [s.from, ...(s.controls ?? []), s.to])
  );
  const points: Point[] = [a];
  for (const s of segments) {
    if (!s.controls) {
      points.push(s.to);
      continue;
    }
    const [c1, c2] = s.controls;
    const steps = Math.max(
      8,
      Math.min(
        256,
        Math.ceil(
          (length(sub(c1, s.from)) +
            length(sub(c2, c1)) +
            length(sub(s.to, c2))) /
            4
        )
      )
    );
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        u = 1 - t;
      points.push(
        add(
          add(times(s.from, u ** 3), times(c1, 3 * u * u * t)),
          add(times(c2, 3 * u * t * t), times(s.to, t ** 3))
        )
      );
    }
  }
  return { path, points, bounds, from, to, segments };
}
export function connectorHead(
  point: Point,
  direction: Point,
  style: ConnectorHead
) {
  const d = unit(direction),
    perpendicular = { x: -d.y, y: d.x };
  const angle = style === 'arrow-filled' ? Math.PI / 6 : Math.PI / 4;
  const back = add(point, times(d, 12 * Math.cos(angle))),
    offset = times(perpendicular, 12 * Math.sin(angle));
  const vertices = [add(back, offset), point, sub(back, offset)];
  return {
    vertices,
    path:
      style === 'arrow' || style === 'arrow-filled'
        ? `M ${pair(vertices[0]!)} L ${pair(point)} L ${pair(vertices[2]!)}${style === 'arrow-filled' ? ' Z' : ''}`
        : '',
    radius: style === 'circle' ? 6 : style === 'circle-small' ? 3 : 0,
  };
}
