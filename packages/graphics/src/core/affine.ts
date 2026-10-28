import type { Bounds, Point } from './model';

/** Column vectors: x'=a*x+c*y+e, y'=b*x+d*y+f. Positive rotation is clockwise. */
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = Object.freeze([1, 0, 0, 1, 0, 0]);
export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scaling = (x: number, y = x): Matrix => [x, 0, 0, y, 0, 0];
export const rotation = (radians: number): Matrix => [
  Math.cos(radians),
  Math.sin(radians),
  -Math.sin(radians),
  Math.cos(radians),
  0,
  0,
];
/** Apply right first, then left. */
export function multiply(l: Matrix, r: Matrix): Matrix {
  return [
    l[0] * r[0] + l[2] * r[1],
    l[1] * r[0] + l[3] * r[1],
    l[0] * r[2] + l[2] * r[3],
    l[1] * r[2] + l[3] * r[3],
    l[0] * r[4] + l[2] * r[5] + l[4],
    l[1] * r[4] + l[3] * r[5] + l[5],
  ];
}
export function inverse(m: Matrix): Matrix {
  const determinant = m[0] * m[3] - m[1] * m[2];
  const magnitude = Math.max(
    Math.abs(m[0]),
    Math.abs(m[1]),
    Math.abs(m[2]),
    Math.abs(m[3])
  );
  if (
    !m.every(Number.isFinite) ||
    !Number.isFinite(determinant) ||
    magnitude === 0 ||
    Math.abs(determinant) <= 1e-12 * magnitude * magnitude
  )
    throw new Error('Noninvertible transform');
  const result: Matrix = [
    m[3] / determinant,
    -m[1] / determinant,
    -m[2] / determinant,
    m[0] / determinant,
    (m[2] * m[5] - m[3] * m[4]) / determinant,
    (m[1] * m[4] - m[0] * m[5]) / determinant,
  ];
  if (!result.every(Number.isFinite))
    throw new Error('Noninvertible transform');
  return result;
}
export const transformPoint = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export const transformVector = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y,
  y: m[1] * p.x + m[3] * p.y,
});
export const around = (pivot: Point, matrix: Matrix): Matrix =>
  multiply(
    translation(pivot.x, pivot.y),
    multiply(matrix, translation(-pivot.x, -pivot.y))
  );
export const corners = (b: Bounds): readonly Point[] => [
  { x: b.x, y: b.y },
  { x: b.x + b.width, y: b.y },
  { x: b.x + b.width, y: b.y + b.height },
  { x: b.x, y: b.y + b.height },
];
export function enclosing(points: readonly Point[]): Bounds {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
/** Separating-axis test for convex polygons (including boundary contact). */
export function intersects(a: readonly Point[], b: readonly Point[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length];
      if (!p || !q) continue;
      const axis = { x: p.y - q.y, y: q.x - p.x };
      const pa = a.map((v) => v.x * axis.x + v.y * axis.y),
        pb = b.map((v) => v.x * axis.x + v.y * axis.y);
      if (
        Math.max(...pa) < Math.min(...pb) - 1e-9 ||
        Math.max(...pb) < Math.min(...pa) - 1e-9
      )
        return false;
    }
  }
  return true;
}
export const sameMatrix = (a: Matrix, b: Matrix) =>
  a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-9);
export const cssMatrix = (m: Matrix) => `matrix(${m.join(',')})`;
