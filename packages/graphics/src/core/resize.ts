import { around, type Matrix, scaling } from './affine';
import type { Bounds, Point } from './model';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
export type ResizeEdge = 'n' | 'e' | 's' | 'w';
export type ResizeHandle = ResizeCorner | ResizeEdge;
export const resizeHandles: readonly ResizeHandle[] = [
  'nw',
  'ne',
  'se',
  'sw',
  'n',
  'e',
  's',
  'w',
];
export const isResizeHandle = (value: unknown): value is ResizeHandle =>
  resizeHandles.some((handle) => handle === value);
export const isResizeEdge = (handle: ResizeHandle): handle is ResizeEdge =>
  handle.length === 1;
export type ResizeModifiers = Readonly<{
  proportional?: boolean;
  fromCenter?: boolean;
}>;

/** Resize in the shape's local axes, always relative to the gesture's start.
 * Pointer delta preserves an off-center handle grab. Modifier changes recompute
 * from the original bounds so toggling them never accumulates drift.
 */
export function resizeBox(
  bounds: Bounds,
  handle: ResizeHandle,
  delta: Point,
  modifiers: ResizeModifiers & { proportionalFit?: 'project' }
): Readonly<{
  bounds: Bounds;
  transform: Matrix;
  scaleX: number;
  scaleY: number;
}> {
  const divisor = modifiers.fromCenter ? 2 : 1;
  const horizontal = handle.includes('w') || handle.includes('e');
  const vertical = handle.includes('n') || handle.includes('s');
  const signX = handle.endsWith('w') ? -1 : 1;
  const signY = handle.startsWith('n') ? -1 : 1;
  const extentX = bounds.width / divisor;
  const extentY = bounds.height / divisor;
  const anchor = modifiers.fromCenter
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : {
        x:
          bounds.x +
          (!horizontal ? bounds.width / 2 : signX < 0 ? bounds.width : 0),
        y:
          bounds.y +
          (!vertical ? bounds.height / 2 : signY < 0 ? bounds.height : 0),
      };
  let sx = horizontal ? 1 + (signX * delta.x) / extentX : 1;
  let sy = vertical ? 1 + (signY * delta.y) / extentY : 1;
  if (modifiers.proportional) {
    const factor = !vertical
      ? Math.abs(sx)
      : !horizontal
        ? Math.abs(sy)
        : modifiers.proportionalFit === 'project'
          ? // Closest point on the aspect-ratio diagonal. Short text boxes must
            // not amplify a small vertical pointer movement into a huge scale.
            (Math.abs(sx) * extentX ** 2 + Math.abs(sy) * extentY ** 2) /
            (extentX ** 2 + extentY ** 2)
          : Math.max(Math.abs(sx), Math.abs(sy));
    sx = (sx < 0 ? -1 : 1) * factor;
    sy = (sy < 0 ? -1 : 1) * factor;
  }
  // Retain the sign through the opposite edge. Only exact collapse needs a tiny
  // nonzero extent so the scene's transforms stay invertible during the gesture.
  sx = (sx < 0 ? -1 : 1) * Math.max(1e-6, Math.abs(sx));
  sy = (sy < 0 ? -1 : 1) * Math.max(1e-6, Math.abs(sy));
  const dx = signX * extentX * sx;
  const dy = signY * extentY * sy;
  const width = Math.abs(dx) * divisor;
  const height = Math.abs(dy) * divisor;
  return {
    transform: around(anchor, scaling(sx, sy)),
    scaleX: sx,
    scaleY: sy,
    bounds: {
      x:
        modifiers.fromCenter || !horizontal
          ? anchor.x - width / 2
          : Math.min(anchor.x, anchor.x + dx),
      y:
        modifiers.fromCenter || !vertical
          ? anchor.y - height / 2
          : Math.min(anchor.y, anchor.y + dy),
      width,
      height,
    },
  };
}

export const resizeBounds = (
  bounds: Bounds,
  handle: ResizeHandle,
  delta: Point,
  modifiers: ResizeModifiers
) => resizeBox(bounds, handle, delta, modifiers).bounds;
