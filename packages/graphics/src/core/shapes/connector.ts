import { corners, enclosing, intersects, transformPoint } from '../affine';
import type { Point, ShapeItem } from '../model';
import { segmentDistance } from './box-geometry';
import {
  type ConnectorHead,
  type ConnectorRoute,
  connectorHead,
  connectorPath,
} from './connector-routing';
import type { ShapeDefinition } from './definition';
import {
  hitShapeLabel,
  type ShapeLabel,
  shapeLabelLayout,
  validShapeLabel,
} from './label';

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
  label?: ShapeLabel;
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
    ...end,
    point: Object.freeze({ ...end.point }),
    ...(end.binding ? { binding: Object.freeze({ ...end.binding }) } : {}),
    ...(end.direction
      ? { direction: Object.freeze({ ...end.direction }) }
      : {}),
  });
const connectorBounds = (
  item: ShapeItem<'connector'>,
  includeLabel: boolean
) => {
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
  const label = includeLabel ? shapeLabelLayout(item) : undefined;
  if (label)
    points.push(
      ...corners({
        x: 0,
        y: 0,
        width: label.geometry.width,
        height: label.geometry.height,
      }).map((p) => transformPoint(label.transform, p))
    );
  const bounds = enclosing(points);
  return {
    ...bounds,
    width: Math.max(0.001, bounds.width),
    height: Math.max(0.001, bounds.height),
  };
};
export const connectorDefinition: ShapeDefinition<'connector'> = {
  type: 'connector',
  label: 'Connector',
  validateGeometry(value): value is ConnectorGeometry {
    if (!value || typeof value !== 'object') return false;
    const g = value as Record<string, unknown>,
      heads = ['none', 'arrow', 'arrow-filled', 'circle', 'circle-small'];
    return (
      (g.label === undefined || validShapeLabel(g.label)) &&
      validEnd(g.start) &&
      validEnd(g.end) &&
      ['straight', 'stepped', 'smooth'].includes(String(g.route)) &&
      heads.includes(String(g.startHead)) &&
      heads.includes(String(g.endHead))
    );
  },
  freezeGeometry: (g) =>
    Object.freeze({
      ...g,
      start: freezeEnd(g.start),
      end: freezeEnd(g.end),
      ...(g.label ? { label: Object.freeze({ ...g.label }) } : {}),
    }),
  sameGeometry: (a, b) =>
    JSON.stringify(a.geometry) === JSON.stringify(b.geometry),
  bounds: (item) => connectorBounds(item, true),
  hitTest: (item, point, context) => {
    if (item.appearance.opacity === 0) return false;
    if (hitShapeLabel(item, point)) return true;
    if (
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
    const label = shapeLabelLayout(item);
    if (
      label &&
      intersects(
        corners({
          x: 0,
          y: 0,
          width: label.geometry.width,
          height: label.geometry.height,
        }).map((p) =>
          transformPoint(world, transformPoint(label.transform, p))
        ),
        corners(box)
      )
    )
      return true;
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
  resize: (item, size, context) => {
    const visible = connectorBounds(item, true),
      geometry = connectorBounds(item, false),
      sx = size.width / visible.width,
      sy = size.height / visible.height,
      midpoint = {
        x: (item.geometry.start.point.x + item.geometry.end.point.x) / 2,
        y: (item.geometry.start.point.y + item.geometry.end.point.y) / 2,
      },
      minimum = connectorBounds(
        {
          ...item,
          geometry: {
            ...item.geometry,
            start: { ...item.geometry.start, point: midpoint },
            end: { ...item.geometry.end, point: midpoint },
          },
        },
        true
      ),
      target = {
        width: Math.max(size.width, minimum.width),
        height: Math.max(size.height, minimum.height),
      },
      scaled = {
        left: size.x + visible.x * sx,
        right: size.x + (visible.x + visible.width) * sx,
        top: size.y + visible.y * sy,
        bottom: size.y + (visible.y + visible.height) * sy,
      },
      handle = context?.handle,
      targetOrigin = {
        x:
          target.width === size.width || handle?.includes('e')
            ? scaled.left
            : handle?.includes('w')
              ? scaled.right - target.width
              : (scaled.left + scaled.right - target.width) / 2,
        y:
          target.height === size.height || handle?.includes('s')
            ? scaled.top
            : handle?.includes('n')
              ? scaled.bottom - target.height
              : (scaled.top + scaled.bottom - target.height) / 2,
      };
    const flatX =
      Math.abs(item.geometry.end.point.x - item.geometry.start.point.x) < 1e-9;
    const flatY =
      Math.abs(item.geometry.end.point.y - item.geometry.start.point.y) < 1e-9;
    const expandFlatX = flatX && size.width > visible.width + 1e-9;
    const expandFlatY = flatY && size.height > visible.height + 1e-9;
    const resize = (e: ConnectorEndpoint, end: boolean) => ({
      ...e,
      point: {
        x: expandFlatX
          ? targetOrigin.x + (end ? target.width : 0)
          : flatX
            ? targetOrigin.x + target.width / 2
            : targetOrigin.x +
              ((e.point.x - geometry.x) * target.width) / geometry.width,
        y: expandFlatY
          ? targetOrigin.y + (end ? target.height : 0)
          : flatY
            ? targetOrigin.y + target.height / 2
            : targetOrigin.y +
              ((e.point.y - geometry.y) * target.height) / geometry.height,
      },
    });
    let start = resize(item.geometry.start, false),
      end = resize(item.geometry.end, true);
    // Labels and heads stay screen-legible instead of scaling with the route.
    // Refine the endpoint span against their fixed visible extents.
    for (let i = 0; i < 8; i++) {
      const candidate = {
        ...item,
        geometry: { ...item.geometry, start, end },
      };
      const actual = connectorBounds(candidate, true);
      if (
        Math.abs(actual.x - targetOrigin.x) < 1e-6 &&
        Math.abs(actual.y - targetOrigin.y) < 1e-6 &&
        Math.abs(actual.width - target.width) < 1e-6 &&
        Math.abs(actual.height - target.height) < 1e-6
      )
        return candidate;
      const adjust = (endpoint: ConnectorEndpoint) => ({
        ...endpoint,
        point: {
          x:
            flatX && !expandFlatX
              ? endpoint.point.x +
                (targetOrigin.x +
                  target.width / 2 -
                  (actual.x + actual.width / 2))
              : targetOrigin.x +
                ((endpoint.point.x - actual.x) * target.width) / actual.width,
          y:
            flatY && !expandFlatY
              ? endpoint.point.y +
                (targetOrigin.y +
                  target.height / 2 -
                  (actual.y + actual.height / 2))
              : targetOrigin.y +
                ((endpoint.point.y - actual.y) * target.height) / actual.height,
        },
      });
      start = adjust(start);
      end = adjust(end);
    }
    return {
      ...item,
      geometry: { ...item.geometry, start, end },
    };
  },
};
