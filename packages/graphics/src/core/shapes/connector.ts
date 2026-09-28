import { corners, enclosing, intersects, transformPoint } from '../affine';
import type { Point } from '../model';
import { segmentDistance } from './box-geometry';
import {
  type ConnectorHead,
  type ConnectorRoute,
  connectorHead,
  connectorPath,
} from './connector-routing';
import type { ShapeDefinition } from './definition';

export const connectorAnchors = [
  'center',
  'top',
  'right',
  'bottom',
  'left',
] as const;
export type ConnectorAnchor = (typeof connectorAnchors)[number];
export type ConnectorBinding = Readonly<{
  targetId: string;
  anchor: ConnectorAnchor;
}>;
export type ConnectorEndpoint = Readonly<{
  /** Local coordinate, also the fallback if the referenced node is unavailable. */
  point: Point;
  binding?: ConnectorBinding;
  /** Optional local outgoing tangent; bound endpoints derive this from the target. */
  direction?: Point;
}>;
export type ConnectorGeometry = Readonly<{
  start: ConnectorEndpoint;
  end: ConnectorEndpoint;
  route: ConnectorRoute;
  startHead: ConnectorHead;
  endHead: ConnectorHead;
}>;
const validPoint = (p: unknown): p is Point =>
  !!p &&
  typeof p === 'object' &&
  'x' in p &&
  'y' in p &&
  typeof p.x === 'number' &&
  typeof p.y === 'number' &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y);
const validEnd = (value: unknown): value is ConnectorEndpoint => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('point' in value) ||
    !validPoint(value.point)
  )
    return false;
  if (
    'direction' in value &&
    value.direction !== undefined &&
    !validPoint(value.direction)
  )
    return false;
  if (!('binding' in value) || value.binding === undefined) return true;
  const b = value.binding;
  return (
    !!b &&
    typeof b === 'object' &&
    'targetId' in b &&
    typeof b.targetId === 'string' &&
    !!b.targetId &&
    'anchor' in b &&
    connectorAnchors.includes(b.anchor as ConnectorAnchor)
  );
};
const headPoints = (point: Point, direction: Point, style: ConnectorHead) => {
  const head = connectorHead(point, direction, style);
  return head.radius
    ? Array.from({ length: 32 }, (_, i) => ({
        x: point.x + Math.cos((i * Math.PI) / 16) * head.radius,
        y: point.y + Math.sin((i * Math.PI) / 16) * head.radius,
      }))
    : head.vertices;
};
const freezeEnd = (end: ConnectorEndpoint): ConnectorEndpoint =>
  Object.freeze({
    point: Object.freeze({ ...end.point }),
    ...(end.binding ? { binding: Object.freeze({ ...end.binding }) } : {}),
    ...(end.direction
      ? { direction: Object.freeze({ ...end.direction }) }
      : {}),
  });
export const connectorDefinition: ShapeDefinition<'connector'> = {
  type: 'connector',
  label: 'Connector',
  validateGeometry(value): value is ConnectorGeometry {
    if (!value || typeof value !== 'object') return false;
    const g = value as Record<string, unknown>,
      heads = ['none', 'arrow', 'arrow-filled', 'circle', 'circle-small'];
    return (
      validEnd(g.start) &&
      validEnd(g.end) &&
      ['straight', 'stepped', 'smooth'].includes(String(g.route)) &&
      heads.includes(String(g.startHead)) &&
      heads.includes(String(g.endHead))
    );
  },
  freezeGeometry: (g) =>
    Object.freeze({ ...g, start: freezeEnd(g.start), end: freezeEnd(g.end) }),
  sameGeometry: (a, b) =>
    JSON.stringify(a.geometry) === JSON.stringify(b.geometry),
  bounds: (item) => {
    const g = item.geometry,
      route = connectorPath(g.start, g.end, g.route);
    const points = [...corners(route.bounds)];
    for (const [end, style, direction] of [
      [g.start, g.startHead, route.from],
      [g.end, g.endHead, route.to],
    ] as const) {
      if (style === 'none') continue;
      const head = connectorHead(end.point, direction, style);
      if (head.radius)
        points.push(
          ...corners({
            x: end.point.x - head.radius,
            y: end.point.y - head.radius,
            width: head.radius * 2,
            height: head.radius * 2,
          })
        );
      else points.push(...head.vertices);
    }
    const b = enclosing(points);
    return {
      ...b,
      width: Math.max(0.001, b.width),
      height: Math.max(0.001, b.height),
    };
  },
  hitTest: (item, point, context) => {
    if (
      item.appearance.opacity === 0 ||
      item.appearance.stroke === 'transparent' ||
      item.appearance.strokeWidth === 0
    )
      return false;
    const g = item.geometry,
      path = connectorPath(g.start, g.end, g.route),
      p = transformPoint(context.worldTransform, point);
    const points = path.points.map((p) =>
      transformPoint(context.worldTransform, p)
    );
    const scale = Math.max(
      Math.hypot(context.worldTransform[0], context.worldTransform[1]),
      Math.hypot(context.worldTransform[2], context.worldTransform[3])
    );
    const tolerance =
      context.tolerance + ((item.appearance.strokeWidth ?? 2) * scale) / 2;
    if (
      points.some(
        (p1, i) => i > 0 && segmentDistance(p, points[i - 1]!, p1) <= tolerance
      )
    )
      return true;
    return (
      [
        ['start', path.from],
        ['end', path.to],
      ] as const
    ).some(([key, direction]) => {
      const style = key === 'start' ? g.startHead : g.endHead;
      if (style === 'none') return false;
      const vertices = headPoints(g[key].point, direction, style).map((v) =>
        transformPoint(context.worldTransform, v)
      );
      const filled = style !== 'arrow';
      if (filled && intersects([p], vertices)) return true;
      return vertices.some(
        (v, i) =>
          (filled || i > 0) &&
          segmentDistance(
            p,
            vertices[(i + vertices.length - 1) % vertices.length]!,
            v
          ) <= tolerance
      );
    });
  },
  intersectsBox: (item, world, box) => {
    const g = item.geometry,
      path = connectorPath(g.start, g.end, g.route),
      bounds = corners(box);
    const points = path.points.map((p) => transformPoint(world, p));
    if (points.some((p, i) => i > 0 && intersects([points[i - 1]!, p], bounds)))
      return true;
    return (
      [
        ['start', path.from, g.startHead],
        ['end', path.to, g.endHead],
      ] as const
    ).some(([key, direction, style]) => {
      if (style === 'none') return false;
      const vertices = headPoints(g[key].point, direction, style).map((p) =>
        transformPoint(world, p)
      );
      return style !== 'arrow'
        ? intersects(vertices, bounds)
        : vertices.some(
            (v, i) => i > 0 && intersects([vertices[i - 1]!, v], bounds)
          );
    });
  },
  resize: (item, size) => {
    const b = connectorDefinition.bounds(item),
      sx = size.width / b.width,
      sy = size.height / b.height;
    const resize = (e: ConnectorEndpoint) => ({
      ...e,
      point: {
        x: size.x + (e.point.x - b.x) * sx,
        y: size.y + (e.point.y - b.y) * sy,
      },
    });
    return {
      ...item,
      geometry: {
        ...item.geometry,
        start: resize(item.geometry.start),
        end: resize(item.geometry.end),
      },
    };
  },
};
