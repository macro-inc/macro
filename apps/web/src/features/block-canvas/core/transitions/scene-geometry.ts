import {
  type ArtifactItem,
  type Bounds,
  children,
  connectorPath,
  enclosing,
  type GraphicsDocument,
  nodeCorners,
  type Point,
  shapeProjection,
  transformPoint,
  worldBounds,
} from '@macro-inc/graphics';
import { artifactContentRect } from './camera-path';

/** Where a slide's document is drawn on the canvas, in world units. */
export function slideContentRect(
  document: GraphicsDocument,
  slide: ArtifactItem
): Bounds {
  const box = document.items[slide.id]
    ? enclosing(nodeCorners(document, slide.id))
    : {
        x: 0,
        y: 0,
        width: slide.geometry.width,
        height: slide.geometry.height,
      };
  return artifactContentRect(box, {
    width: slide.geometry.designWidth,
    height: slide.geometry.designHeight,
  });
}

/** Everything on the canvas, or undefined when it is empty. */
export function sceneBounds(document: GraphicsDocument): Bounds | undefined {
  const points = children(document).flatMap((id) => {
    const bounds = worldBounds(document, id);
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    )
      return [];

    return [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ];
  });
  return points.length ? enclosing(points) : undefined;
}

/**
 * The drawn route of a connector bound to both slides, in world units and
 * oriented from `fromId` to `toId`, or undefined when no connector joins them.
 */
export function connectorRoute(
  document: GraphicsDocument,
  fromId: string,
  toId: string
): Point[] | undefined {
  for (const item of Object.values(document.items)) {
    if (item.type !== 'connector') continue;

    const start = item.geometry.start.binding?.targetId;
    const end = item.geometry.end.binding?.targetId;
    const forward = start === fromId && end === toId;
    const backward = start === toId && end === fromId;
    if (!forward && !backward) continue;

    const projection = shapeProjection(document, item.id);
    if (projection.item?.type !== 'connector') continue;

    const geometry = projection.item.geometry;
    const points = connectorPath(
      geometry.start,
      geometry.end,
      geometry.route
    ).points.map((point) => transformPoint(projection.transform, point));
    return forward ? points : points.reverse();
  }
  return undefined;
}
