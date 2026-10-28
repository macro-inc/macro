import {
  deleteSubtrees,
  drawableIds,
  type GraphicsCommand,
  type GraphicsDocument,
  inverse,
  outermost,
  type Point,
  resolveAppearance,
  resolvedShape,
  shapeDefinition,
  transformPoint,
  worldBounds,
  worldMatrix,
} from '@macro-inc/graphics';

/** Sample the entire swept path, including fast moves between pointer events. */
export function eraserHits(
  document: GraphicsDocument,
  from: Point,
  to: Point,
  radius: number,
  excluded: ReadonlySet<string> = new Set()
): string[] {
  const hits = new Set<string>();
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (radius / 2))
  );
  for (const id of drawableIds(document)) {
    const root = outermost(document, id);
    if (excluded.has(root)) continue;
    const item = resolvedShape(document, id)!;
    const worldTransform = worldMatrix(document, id);
    const padding =
      radius +
      (resolveAppearance(item.appearance).strokeWidth / 2) *
        Math.max(
          Math.hypot(worldTransform[0], worldTransform[1]),
          Math.hypot(worldTransform[2], worldTransform[3])
        );
    const bounds = worldBounds(document, id);
    if (
      bounds.x > Math.max(from.x, to.x) + padding ||
      bounds.y > Math.max(from.y, to.y) + padding ||
      bounds.x + bounds.width < Math.min(from.x, to.x) - padding ||
      bounds.y + bounds.height < Math.min(from.y, to.y) - padding
    )
      continue;
    const local = inverse(worldTransform);
    for (let i = 0; i <= steps; i++) {
      const point = {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      };
      if (
        shapeDefinition(item.type).hitTest(item, transformPoint(local, point), {
          worldTransform,
          tolerance: radius,
        })
      ) {
        hits.add(root);
        break;
      }
    }
  }
  return [...hits];
}

export const eraseCommand: GraphicsCommand<readonly string[]> = {
  id: 'canvas.erase',
  apply: ({ document }, ids) => ({
    document: ids.length ? deleteSubtrees(document, ids) : document,
    selection: [],
  }),
};
