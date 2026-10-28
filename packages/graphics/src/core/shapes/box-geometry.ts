import type { Bounds, Point } from '../model';

export type BoxGeometry = Readonly<{ width: number; height: number }>;
export const boxGeometry = ({ width, height }: Bounds): BoxGeometry => ({
  width,
  height,
});
export const validBoxGeometry = (value: unknown): value is BoxGeometry =>
  typeof value === 'object' &&
  value !== null &&
  'width' in value &&
  typeof value.width === 'number' &&
  Number.isFinite(value.width) &&
  value.width > 0 &&
  'height' in value &&
  typeof value.height === 'number' &&
  Number.isFinite(value.height) &&
  value.height > 0;
export const sameBoxGeometry = (a: BoxGeometry, b: BoxGeometry) =>
  Math.abs(a.width - b.width) < 1e-9 && Math.abs(a.height - b.height) < 1e-9;
export function segmentDistance(
  point: Point,
  start: Point,
  end: Point
): number {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared
          )
        );
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
