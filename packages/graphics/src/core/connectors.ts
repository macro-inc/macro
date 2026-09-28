import { corners, inverse, type Matrix, transformPoint } from './affine';
import type {
  Bounds,
  GraphicsDocument,
  GraphicsItem,
  Point,
  ShapeItem,
} from './model';
import { drawableIds, type SceneOverrides, worldMatrix } from './scene';
import { segmentDistance } from './shapes/box-geometry';
import {
  type ConnectorAnchor,
  type ConnectorBinding,
  type ConnectorEndpoint,
  connectorAnchors,
} from './shapes/connector';
import { sub, unit } from './shapes/connector-routing';
import { isShape, shapeDefinition } from './shapes/registry';

export const canBindConnector = (
  item: GraphicsItem | undefined
): item is Exclude<ShapeItem, ShapeItem<'connector'>> =>
  isShape(item) && item.type !== 'connector';
const fractions: Record<ConnectorAnchor, Point> = {
  center: { x: 0.5, y: 0.5 },
  top: { x: 0.5, y: 0 },
  right: { x: 1, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
};
const normals: Record<ConnectorAnchor, Point> = {
  center: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const anchorPoint = (b: Bounds, anchor: ConnectorAnchor): Point => ({
  x: b.x + fractions[anchor].x * b.width,
  y: b.y + fractions[anchor].y * b.height,
});
const vector = (m: Matrix, p: Point): Point =>
  unit({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y });
const normal = (world: Matrix, n: Point): Point => {
  const m = inverse(world);
  return unit({ x: m[0] * n.x + m[1] * n.y, y: m[2] * n.x + m[3] * n.y });
};
function boundary(
  item: Exclude<ShapeItem, ShapeItem<'connector'>>,
  toward: Point
) {
  const b = shapeDefinition(item.type).bounds(item),
    center = anchorPoint(b, 'center');
  let delta = sub(toward, center);
  if (Math.hypot(delta.x, delta.y) < 1e-8) delta = { x: 1, y: 0 };
  const rx = b.width / 2,
    ry = b.height / 2;
  if (item.type === 'ellipse') {
    const t = 1 / Math.hypot(delta.x / rx, delta.y / ry);
    const d = { x: delta.x * t, y: delta.y * t };
    return {
      point: { x: center.x + d.x, y: center.y + d.y },
      direction: unit({ x: d.x / (rx * rx), y: d.y / (ry * ry) }),
    };
  }
  let t = Math.min(rx / Math.abs(delta.x), ry / Math.abs(delta.y));
  const radius =
    item.type === 'rectangle'
      ? Math.min(item.appearance.cornerRadius ?? 0, rx, ry)
      : 0;
  if (radius) {
    let lo = 0,
      hi = t;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      const x = Math.max(0, Math.abs(delta.x * m) - rx + radius),
        y = Math.max(0, Math.abs(delta.y * m) - ry + radius);
      if (Math.hypot(x, y) > radius) hi = m;
      else lo = m;
    }
    t = lo;
  }
  const dx = delta.x * t,
    dy = delta.y * t;
  const nx = Math.max(0, Math.abs(dx) - rx + radius),
    ny = Math.max(0, Math.abs(dy) - ry + radius);
  const direction =
    radius && (nx || ny)
      ? unit({ x: Math.sign(dx) * nx, y: Math.sign(dy) * ny })
      : Math.abs(dx / rx) > Math.abs(dy / ry)
        ? { x: Math.sign(dx), y: 0 }
        : { x: 0, y: Math.sign(dy) };
  return { point: { x: center.x + dx, y: center.y + dy }, direction };
}
function boundTarget(
  document: GraphicsDocument,
  end: ConnectorEndpoint,
  overrides: SceneOverrides
) {
  const binding = end.binding;
  if (!binding) return;
  const item = overrides[binding.targetId] ?? document.items[binding.targetId];
  if (!canBindConnector(item)) return;
  const world = worldMatrix(document, item.id, overrides),
    bounds = shapeDefinition(item.type).bounds(item);
  return {
    item,
    world,
    binding,
    point: transformPoint(world, anchorPoint(bounds, binding.anchor)),
  };
}
/** Resolve references into the connector's local frame. The document stays untouched. */
export function resolveConnector(
  document: GraphicsDocument,
  item: ShapeItem<'connector'>,
  overrides: SceneOverrides = {}
): ShapeItem<'connector'> {
  const world = worldMatrix(document, item.id, overrides),
    local = inverse(world),
    g = item.geometry;
  const start = boundTarget(document, g.start, overrides),
    end = boundTarget(document, g.end, overrides);
  const a = start?.point ?? transformPoint(world, g.start.point),
    b = end?.point ?? transformPoint(world, g.end.point);
  const resolve = (
    endpoint: ConnectorEndpoint,
    target: typeof start,
    other: Point
  ): ConnectorEndpoint => {
    if (!target) return endpoint;
    const { binding, item, world } = target;
    const resolved =
      binding.anchor === 'center'
        ? boundary(item, transformPoint(inverse(world), other))
        : {
            point: anchorPoint(
              shapeDefinition(item.type).bounds(item),
              binding.anchor
            ),
            direction: normals[binding.anchor],
          };
    return {
      ...endpoint,
      point: transformPoint(local, transformPoint(world, resolved.point)),
      direction: vector(local, normal(world, resolved.direction)),
    };
  };
  return {
    ...item,
    geometry: {
      ...g,
      start: resolve(g.start, start, b),
      end: resolve(g.end, end, a),
    },
  };
}
export type ConnectorPort = ConnectorBinding & Readonly<{ point: Point }>;
export type ConnectorTarget = Readonly<{
  targetId: string;
  ports: readonly ConnectorPort[];
  active?: ConnectorPort;
}>;
export function connectorPorts(
  document: GraphicsDocument,
  overrides: SceneOverrides = {}
): readonly ConnectorPort[] {
  return drawableIds(document).flatMap((id) => {
    const item = overrides[id] ?? document.items[id];
    if (!canBindConnector(item) || item.appearance.opacity === 0) return [];
    const bounds = shapeDefinition(item.type).bounds(item),
      world = worldMatrix(document, id, overrides);
    return connectorAnchors.map((anchor) => ({
      targetId: id,
      anchor,
      point: transformPoint(world, anchorPoint(bounds, anchor)),
    }));
  });
}
export function connectorDropTarget(
  document: GraphicsDocument,
  point: Point,
  tolerance: number
): ConnectorPort | undefined {
  return connectorTargetAt(document, point, tolerance)?.active;
}

/** Hover, starting an endpoint, and dropping it share one target policy. */
export function connectorTargetAt(
  document: GraphicsDocument,
  point: Point,
  tolerance: number
): ConnectorTarget | undefined {
  for (const id of [...drawableIds(document)].reverse()) {
    const item = document.items[id];
    if (!canBindConnector(item) || item.appearance.opacity === 0) continue;
    const definition = shapeDefinition(item.type),
      bounds = definition.bounds(item);
    const world = worldMatrix(document, id),
      local = transformPoint(inverse(world), point);
    const ports = connectorAnchors.map((anchor) => ({
      targetId: id,
      anchor,
      point: transformPoint(world, anchorPoint(bounds, anchor)),
    }));
    let active: ConnectorPort | undefined,
      distance = tolerance;
    for (const port of ports) {
      const d = Math.hypot(point.x - port.point.x, point.y - port.point.y);
      if (d <= distance) {
        active = port;
        distance = d;
      }
    }
    let inside: boolean, core: boolean;
    if (item.type === 'rectangle' || item.type === 'ellipse') {
      // Geometry-only probes: unfilled shapes are targets too, and labels must
      // not turn the shape's entire interior into an outline hit.
      const probe = {
        ...item,
        geometry: { width: item.geometry.width, height: item.geometry.height },
        appearance: {
          ...item.appearance,
          fill: 'black',
          stroke: 'transparent',
          strokeWidth: 0,
        },
      };
      inside = definition.hitTest(probe, local, {
        worldTransform: world,
        tolerance: 0,
      });
      core =
        inside &&
        !definition.hitTest(
          {
            ...probe,
            appearance: {
              ...probe.appearance,
              fill: 'transparent',
              stroke: 'black',
              strokeWidth: Number.EPSILON,
            },
          },
          local,
          { worldTransform: world, tolerance }
        );
    } else {
      inside =
        local.x >= bounds.x &&
        local.x <= bounds.x + bounds.width &&
        local.y >= bounds.y &&
        local.y <= bounds.y + bounds.height;
      const outline = corners(bounds).map((p) => transformPoint(world, p));
      core =
        inside &&
        outline.every(
          (p, i) => segmentDistance(point, p, outline[(i + 1) % 4]!) > tolerance
        );
    }
    if (inside || active)
      return {
        targetId: id,
        ports,
        active: active ?? (core ? ports[0] : undefined),
      };
  }
}
/** Detach removed/external references at their current visible position. */
export function retainConnectorBindings(
  document: GraphicsDocument,
  item: ShapeItem<'connector'>,
  retained: ReadonlySet<string>
): ShapeItem<'connector'> {
  const resolved = resolveConnector(document, item);
  const retain = (end: ConnectorEndpoint, visible: ConnectorEndpoint) =>
    end.binding && !retained.has(end.binding.targetId)
      ? {
          point: visible.point,
          ...(visible.direction ? { direction: visible.direction } : {}),
        }
      : end;
  return {
    ...item,
    geometry: {
      ...item.geometry,
      start: retain(item.geometry.start, resolved.geometry.start),
      end: retain(item.geometry.end, resolved.geometry.end),
    },
  };
}
