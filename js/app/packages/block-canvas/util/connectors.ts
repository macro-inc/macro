import { ARROW_OFFSET } from '@block-canvas/constants';
import type { EdgeSideType } from '@block-canvas/model/CanvasModel';
import {
  type CanvasEdge,
  EDGE_CONNECTION_STYLES,
} from '@block-canvas/model/CanvasModel';
import { rayRayIntersection } from './intersect';
import { clamp, cubicBezierPoint } from './math';
import { PathBuilder } from './svg';
import { Vec2, type Vector2, vec2 } from './vector2';

export type SvgPath = string;

export type EdgeRenderData = {
  fromPos: Vector2;
  fromVec: Vector2;
  toPos: Vector2;
  toVec: Vector2;
  path: SvgPath;
};

type ConnectorPoint = {
  pos: Vector2;
  outgoingVector: Vector2;
};

const pathBuilder = new PathBuilder();

const egdeDirectionLookup: Record<EdgeSideType, Vector2> = {
  top: vec2(0, -1),
  right: vec2(1, 0),
  bottom: vec2(0, 1),
  left: vec2(-1, 0),
};

/**
 * Calculates the midpoint between two vectors.
 * @param a - First vector
 * @param b - Second vector
 * @returns A new vector at the midpoint
 */
function midpoint(a: Vector2, b: Vector2): Vector2 {
  return Vec2.lerp(a, b, 0.5);
}

/**
 * True if a vector is primarily horizontal.
 * @param v - Vector to check
 * @returns True if the vector's x component is larger than its y component
 */
function isHorizontal(v: Vector2) {
  return Math.abs(v.x) > Math.abs(v.y) + 1e-6;
}

/**
 * Generates points for a rectilinear path between two positions with given directions.
 * @param a - Start position
 * @param b - End position
 * @param aDir - Direction vector at start position
 * @param bDir - Direction vector at end position
 * @param padding - Distance to extend from endpoints along their directions
 * @returns Array of points defining the rectilinear path
 */
function getRectilinearPoints(
  a: Vector2,
  b: Vector2,
  aDir: Vector2,
  bDir: Vector2,
  padding: number
) {
  const aNext = a.add(aDir.multiply(padding));
  const bNext = b.add(bDir.multiply(padding));
  const dot = aDir.dot(bDir);
  const horizontal = isHorizontal(aDir);

  // Perpendicular.
  if (dot === 0) {
    // Case 1: perpendicular with a correctly signed intersection position.
    const intersect = rayRayIntersection(a, aDir, b, bDir);
    if (intersect) {
      return [a.clone(), intersect, b.clone()];
    }

    // Case 2: perpendicular with a midpoint.
    const elbow = horizontal ? vec2(aNext.x, bNext.y) : vec2(bNext.x, aNext.y);

    return [a.clone(), aNext, elbow, bNext, b.clone()];
  }

  const delta = bNext.subtract(aNext);
  const aligned = horizontal
    ? Math.sign(aDir.x) === Math.sign(delta.x)
    : Math.sign(aDir.y) === Math.sign(delta.y);

  // Parallel opposite.
  if (dot === -1) {
    if (aligned) {
      const m = midpoint(a, b);
      const mA = horizontal ? vec2(m.x, a.y) : vec2(a.x, m.y);
      const mB = horizontal ? vec2(m.x, b.y) : vec2(b.x, m.y);
      return [a.clone(), mA, mB, b.clone()];
    }

    const m = midpoint(aNext, bNext);
    const mA = horizontal ? vec2(aNext.x, m.y) : vec2(m.x, aNext.y);
    const mB = horizontal ? vec2(bNext.x, m.y) : vec2(m.x, bNext.y);
    return [a.clone(), aNext, mA, mB, bNext, b.clone()];
  }

  // Parallel aligned.
  if (dot === 1) {
    if (aligned) {
      const elbow = horizontal ? vec2(bNext.x, a.y) : vec2(a.x, bNext.y);
      return [a.clone(), elbow, bNext, b.clone()];
    }
    const elbow = horizontal ? vec2(aNext.x, bNext.y) : vec2(bNext.x, aNext.y);
    return [a.clone(), aNext, elbow, bNext, b.clone()];
  }

  console.error('Stepped Connector - Unexpected dot value', dot);
  return [a.clone(), aNext, bNext, b.clone()];
}

/**
 * Filters points that are too close to each other based on a distance threshold.
 * @param points - Array of Vector2 points to filter
 * @param threshold - Minimum distance between points
 * @returns Filtered array with redundant points removed
 */
function mergeByDistance(points: Vector2[], threshold: number = 1): Vector2[] {
  if (points.length < 2) return points;
  let prev = points[0];
  const merged = [prev];
  let t = threshold * threshold;
  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const distance = prev.distanceSq(current);
    if (distance > t) {
      merged.push(current);
      prev = current;
    } else {
    }
  }
  return merged;
}

/**
 * Creates a straight line SVG path between two connector points.
 * @param from - Starting connector point with position and direction
 * @param to - Ending connector point with position and direction
 * @returns SVG path string for a straight line
 */
const linePath = (from: ConnectorPoint, to: ConnectorPoint): SvgPath => {
  pathBuilder.moveTo(from.pos.x, from.pos.y);
  pathBuilder.lineTo(to.pos.x, to.pos.y);
  return pathBuilder.flush();
};

/**
 * Creates a stepped (rectilinear) SVG path between two connector points with rounded corners.
 * @param from - Starting connector point with position and direction
 * @param to - Ending connector point with position and direction
 * @param cornerRadius - Radius for rounded corners in the path
 * @returns SVG path string for a stepped line with rounded corners
 */
const steppedPath = (
  from: ConnectorPoint,
  to: ConnectorPoint,
  cornerRadius: number
): SvgPath => {
  pathBuilder.moveTo(from.pos.x, from.pos.y);
  let points = mergeByDistance(
    getRectilinearPoints(
      from.pos,
      to.pos,
      from.outgoingVector,
      to.outgoingVector,
      ARROW_OFFSET
    ),
    5
  );
  pathBuilder.roundedPolyline(points, cornerRadius);
  return pathBuilder.flush();
};

/**
 * Creates a smooth bezier curve SVG path between two connector points.
 * @param from - Starting connector point with position and direction
 * @param to - Ending connector point with position and direction
 * @returns SVG path string for a cubic bezier curve
 */
const bezierPath = (from: ConnectorPoint, to: ConnectorPoint): SvgPath => {
  pathBuilder.moveTo(from.pos.x, from.pos.y);
  const distance = from.pos.distance(to.pos);
  const str = clamp(distance / 2, 1, 200);
  const cp1 = from.pos.add(from.outgoingVector.multiply(str));
  const cp2 = to.pos.add(to.outgoingVector.multiply(str));
  pathBuilder.cubicBezierTo(cp1.x, cp1.y, cp2.x, cp2.y, to.pos.x, to.pos.y);
  return pathBuilder.flush();
};

const segmentedBezier = (
  from: ConnectorPoint,
  to: ConnectorPoint,
  resolution: number
) => {
  const distance = from.pos.distance(to.pos);
  const str = clamp(distance / 2, 1, 200);
  const cp1 = from.pos.add(from.outgoingVector.multiply(str));
  const cp2 = to.pos.add(to.outgoingVector.multiply(str));
  const points: Vector2[] = [];
  for (let i = 0; i <= resolution; i++) {
    const t = i / resolution;
    const p = cubicBezierPoint(from.pos, cp1, cp2, to.pos, t);
    points.push(p);
  }
  return points;
};

/**
 * Calculates directional vectors for the start and end points of an edge
 * based on its connection style and endpoint properties.
 * @param edge - The canvas edge to calculate vectors for
 * @param rawEndPoints - Tuple containing computed start and end positions of the edge
 * @returns A tuple containing normalized directional vectors for both endpoints
 */
export function getEdgeEndVectors(
  edge: CanvasEdge,
  rawEndPoints: [Vector2, Vector2]
): [Vector2, Vector2] {
  const connectionStyle =
    EDGE_CONNECTION_STYLES[edge.style?.connectionStyle ?? 0];
  const [fromPos, toPos] = rawEndPoints;
  const dir = toPos.subtract(fromPos).normalize();
  const iDir = dir.multiply(-1);

  switch (connectionStyle) {
    case 'stepped':
    case 'smooth':
      const { from, to } = edge;
      const horizontal = isHorizontal(dir);
      const sign = horizontal ? Math.sign(dir.x) : Math.sign(dir.y);

      let fromDir = vec2(0, 0);
      let toDir = vec2(0, 0);
      if (from.type === 'connected') {
        fromDir.setFrom(egdeDirectionLookup[from.side]);
      } else {
        if (horizontal) {
          fromDir.setTo(sign, 0);
        } else {
          fromDir.setTo(0, sign);
        }
      }

      if (to.type === 'connected') {
        toDir.setFrom(egdeDirectionLookup[to.side]);
      } else {
        if (horizontal) {
          toDir.setTo(-sign, 0);
        } else {
          toDir.setTo(0, -sign);
        }
      }

      return [fromDir, toDir];

    default:
      return [dir.clone(), iDir.clone()];
  }
}

/**
 * Converts a canvas edge into render data including positions, vectors and SVG path.
 * Handles different connection styles (straight, stepped, smooth).
 *
 * @param edge - The canvas edge to convert
 * @param rawEndPoints - Array containing start and end positions of the edge
 * @returns Edge render data with positions, vectors and SVG path
 */
export function edgeToRenderData(
  edge: CanvasEdge,
  rawEndPoints: [Vector2, Vector2]
): EdgeRenderData {
  const [fromPos, toPos] = rawEndPoints;
  const [fromVec, toVec] = getEdgeEndVectors(edge, rawEndPoints);
  const connectionStyle =
    EDGE_CONNECTION_STYLES[edge.style?.connectionStyle ?? 0];

  let path: SvgPath;
  switch (connectionStyle) {
    case 'stepped':
      path = steppedPath(
        { pos: fromPos, outgoingVector: fromVec },
        {
          pos: toPos,
          outgoingVector: toVec.clone(),
        },
        10
      );
      break;

    case 'smooth':
      path = bezierPath(
        { pos: fromPos, outgoingVector: fromVec },
        {
          pos: toPos,
          outgoingVector: toVec.clone(),
        }
      );
      break;

    default:
      path = linePath(
        { pos: fromPos, outgoingVector: fromVec },
        {
          pos: toPos,
          outgoingVector: toVec.clone(),
        }
      );
      break;
  }

  return {
    fromPos,
    fromVec,
    toPos,
    toVec,
    path,
  };
}

export function edgeToCollisionData(
  edge: CanvasEdge,
  rawEndPoints: [Vector2, Vector2]
): Vector2[] {
  const [fromPos, toPos] = rawEndPoints;
  const [fromVec, toVec] = getEdgeEndVectors(edge, rawEndPoints);
  const connectionStyle =
    EDGE_CONNECTION_STYLES[edge.style?.connectionStyle ?? 0];

  switch (connectionStyle) {
    case 'stepped':
      return getRectilinearPoints(fromPos, toPos, fromVec, toVec, ARROW_OFFSET);
    case 'smooth':
      return segmentedBezier(
        {
          pos: fromPos,
          outgoingVector: fromVec,
        },
        {
          pos: toPos,
          outgoingVector: toVec,
        },
        10
      );
    default:
      return [fromPos, toPos];
  }
}
