import { type Vector2, vec2 } from './vector2';

export function rayRayIntersection(
  a: Vector2,
  aDir: Vector2,
  b: Vector2,
  bDir: Vector2
): Vector2 | null {
  const det = aDir.x * bDir.y - aDir.y * bDir.x;
  if (Math.abs(det) < 1e-8) {
    return null;
  }
  const ba = b.subtract(a);
  const t = (ba.x * bDir.y - ba.y * bDir.x) / det;
  const u = (ba.x * aDir.y - ba.y * aDir.x) / det;
  if (t >= 0 && u >= 0) {
    return a.add(aDir.multiply(t));
  }
  return null;
}

export function lineSegmentIntersection(
  s1: Vector2,
  e1: Vector2,
  s2: Vector2,
  e2: Vector2
): Vector2 | null {
  const denominator =
    (e2.y - s2.y) * (e1.x - s1.x) - (e2.x - s2.x) * (e1.y - s1.y);

  if (denominator === 0) return null; // Parallel lines

  const ua =
    ((e2.x - s2.x) * (s1.y - s2.y) - (e2.y - s2.y) * (s1.x - s2.x)) /
    denominator;

  const ub =
    ((e1.x - s1.x) * (s1.y - s2.y) - (e1.y - s1.y) * (s1.x - s2.x)) /
    denominator;

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return vec2(s1.x + ua * (e1.x - s1.x), s1.y + ua * (e1.y - s1.y));
  }

  return null;
}
