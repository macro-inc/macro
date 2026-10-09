import {
  inverse,
  type Matrix,
  multiply,
  scaling,
  transformPoint,
  transformVector,
} from './affine';
import type { Bounds, GraphicsDocument, GraphicsItem, Point } from './model';
import type { ResizeHandle } from './resize';
import { resolvedShape, worldMatrix } from './scene';
import { isShape, shapeDefinition } from './shapes/registry';
import type { TextMeasurer } from './shapes/text';
import { selectedShapeIds } from './style-selection';

function oppositeAnchor(bounds: Bounds, handle: ResizeHandle): Point {
  const right = bounds.x + bounds.width,
    bottom = bounds.y + bounds.height;
  switch (handle) {
    case 'e':
    case 's':
    case 'se':
      return { x: bounds.x, y: bounds.y };
    case 'w':
    case 'sw':
      return { x: right, y: bounds.y };
    case 'n':
    case 'ne':
      return { x: bounds.x, y: bottom };
    case 'nw':
      return { x: right, y: bottom };
  }
}

function localResizeHandle(handle: ResizeHandle, world: Matrix): ResizeHandle {
  const direction = transformVector(inverse(world), {
    x: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
    y: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
  });
  const threshold =
    Math.max(Math.abs(direction.x), Math.abs(direction.y)) * 1e-8;
  const vertical =
    Math.abs(direction.y) <= threshold ? '' : direction.y < 0 ? 'n' : 's';
  const horizontal =
    Math.abs(direction.x) <= threshold ? '' : direction.x < 0 ? 'w' : 'e';
  return `${vertical}${horizontal}` as ResizeHandle;
}

/** Selected groups may scale their frame; ink opts to absorb that scale into
 * samples and cancel the added magnification in its local pose. */
export function regenerateScaledShapes(
  document: GraphicsDocument,
  selected: readonly string[],
  nodes: Record<string, GraphicsItem>
) {
  for (const id of selectedShapeIds(document, selected)) {
    const item = resolvedShape(document, id);
    if (!isShape(item)) continue;
    const definition = shapeDefinition(item.type);
    if (!definition.regenerateOnScale) continue;
    const before = worldMatrix(document, id);
    const after = worldMatrix(document, id, nodes);
    const sx =
      Math.hypot(after[0], after[1]) / Math.hypot(before[0], before[1]);
    const sy =
      Math.hypot(after[2], after[3]) / Math.hypot(before[2], before[3]);
    const bounds = definition.bounds(item);
    nodes[id] = {
      ...definition.resize(item, {
        x: 0,
        y: 0,
        width: bounds.width * sx,
        height: bounds.height * sy,
      }),
      transform: multiply(
        inverse(worldMatrix(document, item.placement.parentId, nodes)),
        multiply(after, scaling(1 / sx, 1 / sy))
      ),
    };
  }
}

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
  delta: Matrix,
  measureText?: TextMeasurer,
  handle?: ResizeHandle
): Record<string, GraphicsItem> {
  const nodes: Record<string, GraphicsItem> = Object.create(null);
  for (const id of selectedShapeIds(document, selected)) {
    const item = resolvedShape(document, id);
    if (!isShape(item)) continue;
    const world = worldMatrix(document, id);
    const stretched = multiply(delta, world);
    const sx =
      Math.hypot(stretched[0], stretched[1]) / Math.hypot(world[0], world[1]);
    const sy =
      Math.hypot(stretched[2], stretched[3]) / Math.hypot(world[2], world[3]);
    const definition = shapeDefinition(item.type);
    const bounds = definition.bounds(item);
    const localHandle = handle ? localResizeHandle(handle, world) : undefined;
    const center = transformPoint(stretched, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    const resized = definition.resize(
      item,
      {
        x: 0,
        y: 0,
        width: bounds.width * sx,
        height: bounds.height * sy,
      },
      { measureText, handle: localHandle }
    );
    const nextBounds = definition.bounds(resized);
    const nextAnchor = localHandle
      ? oppositeAnchor(nextBounds, localHandle)
      : {
          x: nextBounds.x + nextBounds.width / 2,
          y: nextBounds.y + nextBounds.height / 2,
        };
    const worldAnchor = localHandle
      ? transformPoint(stretched, oppositeAnchor(bounds, localHandle))
      : center;
    const a = stretched[0] / sx,
      b = stretched[1] / sx;
    const c = stretched[2] / sy,
      d = stretched[3] / sy;
    const nextWorld: Matrix = [
      a,
      b,
      c,
      d,
      worldAnchor.x - a * nextAnchor.x - c * nextAnchor.y,
      worldAnchor.y - b * nextAnchor.x - d * nextAnchor.y,
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
