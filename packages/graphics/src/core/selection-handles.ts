import { enclosing } from './affine';
import type { Point } from './model';
import type { ResizeHandle } from './resize';

/**
 * How far the rotation knob stands off the selection's top edge, on screen:
 * further for fingers, so its target clears the corners' and the edge's.
 */
export const rotationKnobOffset = (touchHandles: boolean | undefined) =>
  touchHandles ? 32 : 16;

/** A finger takes a corner or the knob from this far away, and an edge from this. */
const TOUCH_HANDLE_REACH = 16;
const TOUCH_EDGE_REACH = 12;
const TOUCH_EDGE_REACH_INSIDE = 8;

const CORNER_HANDLES = ['nw', 'ne', 'se', 'sw'] as const;
const EDGE_HANDLES = ['n', 'e', 's', 'w'] as const;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const along = length
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * dx + (point.y - start.y) * dy) / length
        )
      )
    : 0;
  return distance(point, { x: start.x + dx * along, y: start.y + dy * along });
}

/** Whether a point is inside the convex quad its corners trace in order. */
function insideFrame(corners: readonly Point[], point: Point) {
  let sign = 0;
  for (let index = 0; index < corners.length; index++) {
    const a = corners[index]!;
    const b = corners[(index + 1) % corners.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (!cross) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

/**
 * Where the rotation knob sits for a selection whose frame has these screen
 * corners (nw, ne, se, sw). One shape carries the knob off its own top edge,
 * rotated with it; a group or several shapes carry it above their bounds.
 */
export function rotationKnobPoint(
  corners: readonly Point[],
  oriented: boolean,
  offset: number
): Point | undefined {
  const [a, b, c] = corners;
  if (corners.length !== 4 || !a || !b || !c) return undefined;
  if (!oriented) {
    const bounds = enclosing(corners);
    return { x: bounds.x + bounds.width / 2, y: bounds.y - offset };
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edge = Math.hypot(dx, dy);
  if (!edge) return undefined;
  // Keep the normal outside the box even after a resize flips an axis.
  const direction = dy * (c.x - a.x) - dx * (c.y - a.y) > 0 ? -1 : 1;
  const reach = (offset * direction) / edge;
  return {
    x: (a.x + b.x) / 2 + dy * reach,
    y: (a.y + b.y) / 2 - dx * reach,
  };
}

/** How far along a side a point lies from the corner the side starts at. */
function alongSide(point: Point, corner: Point, next: Point) {
  const length = distance(corner, next);
  if (!length) return 0;
  return (
    ((point.x - corner.x) * (next.x - corner.x) +
      (point.y - corner.y) * (next.y - corner.y)) /
    length
  );
}

/**
 * Whether a corner may claim a point: only from the outer quarter of each side
 * that meets at it. A short side keeps its middle for its edge handle, so the
 * side of one line of text sets its width instead of scaling it.
 */
function cornerClaims(corners: readonly Point[], index: number, point: Point) {
  const corner = corners[index]!;
  return [corners[(index + 1) % 4]!, corners[(index + 3) % 4]!].every(
    (neighbour) =>
      alongSide(point, corner, neighbour) <= distance(corner, neighbour) / 4
  );
}

/**
 * The handle a finger takes when it lands near the selection's handles. The
 * handles stay small on screen; this is their target for touch: the knob and
 * the corners from 16px away, then the edges from 12px.
 *
 * Inside the frame the reach shrinks with the frame (a quarter of its shorter
 * side for a corner, a sixth for an edge, and never more than 8px for an
 * edge), so the middle of even a small shape still moves it.
 */
export function touchHandleAt(
  corners: readonly Point[],
  knob: Point | undefined,
  point: Point
): ResizeHandle | 'rotate' | undefined {
  if (corners.length !== 4) return undefined;
  if (knob && distance(knob, point) <= TOUCH_HANDLE_REACH) return 'rotate';

  const shorterSide = Math.min(
    distance(corners[0]!, corners[1]!),
    distance(corners[1]!, corners[2]!)
  );
  const inside = insideFrame(corners, point);
  const cornerReach = inside
    ? Math.min(TOUCH_HANDLE_REACH, shorterSide / 4)
    : TOUCH_HANDLE_REACH;
  const edgeReach = inside
    ? Math.min(TOUCH_EDGE_REACH_INSIDE, shorterSide / 6)
    : TOUCH_EDGE_REACH;

  let handle: ResizeHandle | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 4; index++) {
    const away = distance(corners[index]!, point);
    if (away > cornerReach || away >= nearest) continue;
    if (!cornerClaims(corners, index, point)) continue;
    nearest = away;
    handle = CORNER_HANDLES[index];
  }
  // A corner that claims the point wins over the edges that meet at it.
  if (handle) return handle;

  for (let index = 0; index < 4; index++) {
    const away = distanceToSegment(
      point,
      corners[index]!,
      corners[(index + 1) % 4]!
    );
    if (away > edgeReach || away >= nearest) continue;
    nearest = away;
    handle = EDGE_HANDLES[index];
  }
  return handle;
}
