/**
 * Algorithm and code by Vladimir Agafonkin.
 * (c) 2017, Vladimir Agafonkin
 * Simplify.js, a high-performance JS polyline simplification library
 * mourner.github.io/simplify-js released under the BSD license.
 *
 * Note: I (seamus) copy-pasted for the sake of ESM import modification and types.
 */

import type { Vector2 } from './vector2';

type Point = Vector2;

function getSqDist(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return dx * dx + dy * dy;
}

// Square distance from a point to a segment
function getSqSegDist(p: Point, p1: Point, p2: Point): number {
  let x = p1.x;
  let y = p1.y;
  const dx = p2.x - x;
  const dy = p2.y - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x;
      y = p2.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  const dx2 = p.x - x;
  const dy2 = p.y - y;
  return dx2 * dx2 + dy2 * dy2;
}

// Basic distance-based simplification
function simplifyRadialDist(points: Point[], sqTolerance: number): Point[] {
  let prevPoint = points[0];
  const newPoints: Point[] = [prevPoint];
  let point: Point;

  for (let i = 1, len = points.length; i < len; i++) {
    point = points[i];
    if (getSqDist(point, prevPoint) > sqTolerance) {
      newPoints.push(point);
      prevPoint = point;
    }
  }

  //@ts-ignore
  if (prevPoint !== point) newPoints.push(point);
  return newPoints;
}

function simplifyDPStep(
  points: Point[],
  first: number,
  last: number,
  sqTolerance: number,
  simplified: Point[]
): void {
  let maxSqDist = sqTolerance;
  let index: number | undefined;

  for (let i = first + 1; i < last; i++) {
    const sqDist = getSqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }

  if (maxSqDist > sqTolerance) {
    if (index && index - first > 1)
      simplifyDPStep(points, first, index, sqTolerance, simplified);

    if (index) simplified.push(points[index]);

    if (last - (index || last) > 1)
      simplifyDPStep(points, index || last, last, sqTolerance, simplified);
  }
}

// Simplification using Ramer-Douglas-Peucker algorithm
function simplifyDouglasPeucker(points: Point[], sqTolerance: number): Point[] {
  const last = points.length - 1;
  const simplified: Point[] = [points[0]];

  simplifyDPStep(points, 0, last, sqTolerance, simplified);
  simplified.push(points[last]);

  return simplified;
}

// Both algorithms combined for awesome performance
export function simplify(
  points: Point[],
  tolerance?: number,
  highestQuality?: boolean
): Point[] {
  if (points.length <= 2) return points;

  const sqTolerance = tolerance !== undefined ? tolerance * tolerance : 1;

  const simplifiedPoints = highestQuality
    ? points
    : simplifyRadialDist(points, sqTolerance);

  return simplifyDouglasPeucker(simplifiedPoints, sqTolerance);
}
