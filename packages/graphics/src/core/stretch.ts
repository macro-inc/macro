import { inverse, type Matrix, multiply, transformPoint } from './affine';
import type { GraphicsDocument, GraphicsItem } from './model';
import { worldMatrix } from './scene';
import { isShape, shapeDefinition } from './shapes/registry';
import { selectedShapeIds } from './style-selection';

/** Nonuniform selection resize, retaining leaf axes and reflecting them on flips.
 * Move centers with the selection transform and resize along the leaf's axes.
 * Group frames stay intact; solve each leaf's new pose in its own parent frame.
 * The selection frame permits nonuniform resizing only when all descendant axes
 * align with its axes (including quarter turns), so the result fits that frame
 * exactly. Incompatible axes take the uniform selected-root transform path.
 */
export function stretchShapes(
  document: GraphicsDocument,
  selected: readonly string[],
  delta: Matrix
): Record<string, GraphicsItem> {
  const nodes: Record<string, GraphicsItem> = Object.create(null);
  for (const id of selectedShapeIds(document, selected)) {
    const item = document.items[id];
    if (!isShape(item)) continue;
    const world = worldMatrix(document, id);
    const stretched = multiply(delta, world);
    const sx =
      Math.hypot(stretched[0], stretched[1]) / Math.hypot(world[0], world[1]);
    const sy =
      Math.hypot(stretched[2], stretched[3]) / Math.hypot(world[2], world[3]);
    const definition = shapeDefinition(item.type);
    const bounds = definition.bounds(item);
    const center = transformPoint(stretched, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    const resized = definition.resize(item, {
      x: 0,
      y: 0,
      width: bounds.width * sx,
      height: bounds.height * sy,
    });
    const nextBounds = definition.bounds(resized);
    const x = nextBounds.x + nextBounds.width / 2,
      y = nextBounds.y + nextBounds.height / 2;
    const a = stretched[0] / sx,
      b = stretched[1] / sx;
    const c = stretched[2] / sy,
      d = stretched[3] / sy;
    const nextWorld: Matrix = [
      a,
      b,
      c,
      d,
      center.x - a * x - c * y,
      center.y - b * x - d * y,
    ];
    nodes[id] = {
      ...resized,
      transform: multiply(
        inverse(worldMatrix(document, item.placement.parentId)),
        nextWorld
      ),
    };
  }
  return nodes;
}
