import {
  corners,
  enclosing,
  IDENTITY,
  inverse,
  type Matrix,
  multiply,
  transformPoint,
} from './affine';
import type { Bounds, GraphicsDocument, Point } from './model';
import {
  children,
  nodeBoundsPoints,
  roots,
  type SceneOverrides,
  shapeProjection,
  worldMatrix,
} from './scene';
import { isShape, shapeDefinition } from './shapes/registry';

/** The same coordinate frame drives selection chrome and resize math. Bounds
 * are in frame space; corners and center are in world space. This is derived
 * editor state, never document data.
 */
export type SelectionFrame = Readonly<{
  bounds: Bounds;
  transform: Matrix;
  angle: number;
  corners: readonly Point[];
  center: Point;
  canDeform: boolean;
}>;

export function selectionFrame(
  document: GraphicsDocument,
  selection: readonly string[],
  overrides: SceneOverrides = {}
): SelectionFrame | undefined {
  const selected = roots(document, selection);
  const firstId = selected[0];
  if (!firstId) return undefined;
  const first = overrides[firstId] ?? document.items[firstId];
  const projection = shapeProjection(document, firstId, overrides);
  const world = projection.transform;
  const singleShape = selected.length === 1 && isShape(first);
  // A single leaf retains its full affine frame, including existing ancestor
  // scale/shear. Groups and multiple roots always use a world-aligned box.
  const angle = singleShape ? Math.atan2(world[1], world[0]) : 0;
  const transform = singleShape ? world : IDENTITY;
  const fromWorld = inverse(transform);
  const points = selected.flatMap((id) =>
    nodeBoundsPoints(document, id, overrides)
  );
  if (!points.length) return undefined;
  const bounds = singleShape
    ? shapeDefinition(first.type).bounds(projection.item!)
    : enclosing(points.map((point) => transformPoint(fromWorld, point)));
  const compatible = (id: string): boolean => {
    const item = overrides[id] ?? document.items[id];
    if (isShape(item) && shapeDefinition(item.type).canDeform === false)
      return false;
    const matrix = multiply(fromWorld, worldMatrix(document, id, overrides));
    const x = Math.hypot(matrix[0], matrix[1]);
    const y = Math.hypot(matrix[2], matrix[3]);
    // Parallel or quarter-turn axes can stretch without introducing shear.
    // Check both axes: a sheared ancestor cannot be classified by angle alone.
    const aligned =
      (Math.abs(matrix[1]) <= x * 1e-8 && Math.abs(matrix[2]) <= y * 1e-8) ||
      (Math.abs(matrix[0]) <= x * 1e-8 && Math.abs(matrix[3]) <= y * 1e-8);
    return aligned && children(document, id).every(compatible);
  };
  return {
    bounds,
    transform,
    angle,
    corners: corners(bounds).map((point) => transformPoint(transform, point)),
    center: transformPoint(transform, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    }),
    canDeform: singleShape || selected.every(compatible),
  };
}

/** Selection interiors can move the selected roots without picking a leaf. */
export function selectionContainsPoint(
  frame: SelectionFrame,
  point: Point
): boolean {
  const local = transformPoint(inverse(frame.transform), point);
  const b = frame.bounds;
  return (
    local.x >= b.x &&
    local.x <= b.x + b.width &&
    local.y >= b.y &&
    local.y <= b.y + b.height
  );
}
