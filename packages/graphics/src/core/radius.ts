import { inverse, type Matrix, transformPoint } from './affine';
import type { Point, RectangleItem } from './model';

export const radiusHandles = [
  'radius-nw',
  'radius-ne',
  'radius-se',
  'radius-sw',
] as const;
export type RadiusHandle = (typeof radiusHandles)[number];
export const isRadiusHandle = (
  value: string | undefined | null
): value is RadiusHandle => radiusHandles.some((handle) => handle === value);

export const rectangleRadius = (item: RectangleItem) =>
  Math.min(
    item.appearance.cornerRadius ?? 0,
    item.geometry.width / 2,
    item.geometry.height / 2
  );

export function radiusHandlePoint(
  item: RectangleItem,
  handle: RadiusHandle,
  inset: Point = { x: 0, y: 0 }
): Point {
  const radius = rectangleRadius(item);
  const x = Math.min(item.geometry.width / 2, Math.max(radius, inset.x));
  const y = Math.min(item.geometry.height / 2, Math.max(radius, inset.y));
  return {
    x: handle.endsWith('w') ? x : item.geometry.width - x,
    y:
      handle === 'radius-nw' || handle === 'radius-ne'
        ? y
        : item.geometry.height - y,
  };
}

/** Radius uses whole local pixels, independent of the scene's snapping policy. */
export function dragRectangleRadius(
  item: RectangleItem,
  world: Matrix,
  handle: RadiusHandle,
  origin: Point,
  point: Point
): RectangleItem {
  const fromWorld = inverse(world);
  const start = transformPoint(fromWorld, origin);
  const end = transformPoint(fromWorld, point);
  const dx = (end.x - start.x) * (handle.endsWith('w') ? 1 : -1);
  const dy =
    (end.y - start.y) *
    (handle === 'radius-nw' || handle === 'radius-ne' ? 1 : -1);
  // Clicking a handle must not round an existing fractional or oversized value.
  if (Math.abs(dx + dy) < 1e-9) return item;
  const cornerRadius = Math.max(
    0,
    Math.min(
      Math.floor(Math.min(item.geometry.width, item.geometry.height) / 2),
      Math.round(rectangleRadius(item) + (dx + dy) / 2)
    )
  );
  return cornerRadius === (item.appearance.cornerRadius ?? 0)
    ? item
    : {
        ...item,
        appearance: Object.freeze({ ...item.appearance, cornerRadius }),
      };
}
