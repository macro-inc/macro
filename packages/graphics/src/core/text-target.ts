import { inverse, transformPoint } from './affine';
import type { GraphicsDocument, Point } from './model';
import { drawableIds, resolvedShape, worldMatrix } from './scene';
import { canLabel } from './shapes/label';
import { shapeDefinition } from './shapes/registry';

/** Text gestures may enter an unfilled shape's interior. Normal selection still
 * uses painted picking. Frontmost painted non-text shapes block text behind them. */
export function textTargetAt(
  document: GraphicsDocument,
  point: Point
): string | undefined {
  for (const id of drawableIds(document).reverse()) {
    const item = resolvedShape(document, id);
    if (!item || item.appearance.opacity === 0) continue;
    const world = worldMatrix(document, id),
      local = transformPoint(inverse(world), point);
    const definition = shapeDefinition(item.type);
    const target = item.type === 'text' || canLabel(item);
    const testItem = canLabel(item)
      ? { ...item, appearance: { ...item.appearance, fill: 'black' } }
      : item;
    if (
      definition.hitTest(testItem, local, {
        worldTransform: world,
        tolerance: 0,
      })
    )
      return target ? id : undefined;
  }
}
