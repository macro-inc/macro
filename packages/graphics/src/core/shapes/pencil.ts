import {
  getStrokeOutlinePoints,
  getStrokePoints,
  type StrokeOptions,
} from 'perfect-freehand';
import { corners, enclosing, transformPoint } from '../affine';
import { resolveAppearance } from '../appearance';
import type { Bounds, PencilItem, Point } from '../model';
import { segmentDistance } from './box-geometry';
import type { ShapeDefinition } from './definition';

export type PencilPoint = readonly [x: number, y: number, pressure: number];
export type PencilGeometry = Readonly<{
  points: readonly PencilPoint[];
  simulatePressure: boolean;
}>;
export const MAX_PENCIL_POINTS = 16384;
type Ink = {
  outline: Point[];
  path: string;
  centerline: string;
  bounds: Bounds;
};
const cache = new WeakMap<PencilGeometry, { size: number; ink: Ink }>();

/** Document samples remain raw. Brush policy and generated ink stay internal.
 * Rebuild after resizing so mouse pressure follows the new point spacing. */
export function pencilInk(item: PencilItem) {
  const size = resolveAppearance(item.appearance).strokeWidth;
  const cached = cache.get(item.geometry);
  if (cached?.size === size) return cached.ink;
  const options: StrokeOptions = {
    size: Math.max(size, 0.01),
    thinning: 0.5,
    smoothing: 0.65,
    streamline: 0.6,
    simulatePressure: item.geometry.simulatePressure,
    easing: (pressure) => Math.sin((pressure * Math.PI) / 2),
    last: true,
  };
  const strokePoints = getStrokePoints(
    item.geometry.points.map((p) => [...p]),
    options
  );
  const outline = getStrokeOutlinePoints(strokePoints, options).map(
    ([x, y]) => ({ x, y })
  );
  // The same polygon is painted and picked, including self-overlapping strokes.
  const path = outline.length
    ? `M${outline.map((p) => `${p.x},${p.y}`).join('L')}Z`
    : '';
  // Use the brush's streamlined centerline, not the unsmoothed input samples.
  // A tap gets a zero-length segment, painted as a dot with round caps.
  const centerline =
    item.geometry.points.length === 1
      ? `M${item.geometry.points[0]![0]},${item.geometry.points[0]![1]}l0,0`
      : `M${strokePoints.map(({ point }) => point.join(',')).join('L')}`;
  const ink = { outline, path, centerline, bounds: enclosing(outline) };
  // Mutable Solid-store projections must keep their dependency reads; only plain
  // immutable core geometries can safely be cached by identity.
  if (Object.isFrozen(item.geometry)) cache.set(item.geometry, { size, ink });
  return ink;
}

/** SVG's default nonzero winding rule, including ink crossing over itself. */
function contains(polygon: readonly Point[], point: Point) {
  let winding = 0;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && side > 0) winding++;
    if (a.y > point.y && b.y <= point.y && side < 0) winding--;
  });
  return winding !== 0;
}

function segmentIntersectsBox(a: Point, b: Point, box: Bounds) {
  let low = 0,
    high = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, box.x, box.x + box.width],
    [a.y, b.y - a.y, box.y, box.y + box.height],
  ] as const) {
    if (delta === 0) {
      if (start < min || start > max) return false;
    } else {
      const t1 = (min - start) / delta,
        t2 = (max - start) / delta;
      low = Math.max(low, Math.min(t1, t2));
      high = Math.min(high, Math.max(t1, t2));
      if (low > high) return false;
    }
  }
  return true;
}

export const pencilDefinition: ShapeDefinition<'pencil'> = {
  type: 'pencil',
  label: 'Pencil',
  regenerateOnScale: true,
  validateGeometry: (value): value is PencilGeometry => {
    if (!value || typeof value !== 'object') return false;
    const geometry = value as Partial<PencilGeometry>;
    return (
      typeof geometry.simulatePressure === 'boolean' &&
      Array.isArray(geometry.points) &&
      geometry.points.length > 0 &&
      geometry.points.length <= MAX_PENCIL_POINTS &&
      geometry.points.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 3 &&
          p.every(Number.isFinite) &&
          p[2] >= 0 &&
          p[2] <= 1
      )
    );
  },
  freezeGeometry: (geometry) =>
    Object.freeze({
      simulatePressure: geometry.simulatePressure,
      points: Object.freeze(
        geometry.points.map((point) => Object.freeze([...point]) as PencilPoint)
      ),
    }),
  bounds: (item) => pencilInk(item).bounds,
  resize: (item, size) => {
    const bounds = pencilInk(item).bounds;
    const sx = size.width / bounds.width,
      sy = size.height / bounds.height;
    return {
      ...item,
      geometry: pencilDefinition.freezeGeometry({
        ...item.geometry,
        points: item.geometry.points.map(([x, y, pressure]) => [
          x * sx,
          y * sy,
          pressure,
        ]),
      }),
    };
  },
  sameGeometry: (a, b) =>
    a.geometry.simulatePressure === b.geometry.simulatePressure &&
    a.geometry.points.length === b.geometry.points.length &&
    a.geometry.points.every((point, i) =>
      point.every((v, j) => v === b.geometry.points[i]?.[j])
    ),
  hitTest: (item, point, context) => {
    const style = resolveAppearance(item.appearance);
    if (
      style.opacity === 0 ||
      style.stroke === 'transparent' ||
      style.strokeWidth === 0
    )
      return false;
    const { outline } = pencilInk(item);
    if (contains(outline, point)) return true;
    const worldPoint = transformPoint(context.worldTransform, point);
    const polygon = outline.map((p) =>
      transformPoint(context.worldTransform, p)
    );
    return polygon.some(
      (p, i) =>
        segmentDistance(worldPoint, p, polygon[(i + 1) % polygon.length]!) <=
        context.tolerance
    );
  },
  intersectsBox: (item, world, box) => {
    const polygon = pencilInk(item).outline.map((p) =>
      transformPoint(world, p)
    );
    return (
      corners(box).some((point) => contains(polygon, point)) ||
      polygon.some((p, i) =>
        segmentIntersectsBox(p, polygon[(i + 1) % polygon.length]!, box)
      )
    );
  },
};
