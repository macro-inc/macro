import type { Bounds, Camera, Point } from '@macro-inc/graphics';
import { zoomAt } from '@macro-inc/graphics';

export type { Bounds, Camera, Point };

export type Size = { width: number; height: number };

export const BOARD_MIN_SCALE = 0.12;
export const BOARD_MAX_SCALE = 2.5;
export const ZOOM_STEP = 1.25;

/**
 * How much detail nodes draw at a scale. Far shows the map (titles and
 * counts), mid shows the latest bubble, near shows the conversation.
 */
export type ZoomDetail = 'far' | 'mid' | 'near';

export function zoomDetail(scale: number): ZoomDetail {
  if (scale < 0.42) return 'far';
  if (scale < 0.95) return 'mid';
  return 'near';
}

export function clampScale(scale: number): number {
  return Math.min(BOARD_MAX_SCALE, Math.max(BOARD_MIN_SCALE, scale));
}

/** Zooms around a screen point, keeping the world point under it fixed. */
export function zoomCameraAt(
  camera: Camera,
  anchor: Point,
  factor: number
): Camera {
  return zoomAt(camera, anchor, clampScale(camera.scale * factor));
}

/** Scale factor for one wheel or pinch event; trackpads send small deltas. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaY;
  return Math.exp(-Math.max(-60, Math.min(60, pixels)) * 0.01);
}

/**
 * The camera that shows all of `bounds` centered in a viewport, never
 * enlarging past `maxScale` so a sparse board stays legible.
 */
export function fitCamera(
  bounds: Bounds,
  viewport: Size,
  options: { padding?: number; maxScale?: number } = {}
): Camera {
  const padding = options.padding ?? 48;
  const maxScale = options.maxScale ?? 1;
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return { x: viewport.width / 2, y: viewport.height / 2, scale: 1 };
  }
  const scale = clampScale(
    Math.min(
      maxScale,
      (viewport.width - padding * 2) / bounds.width,
      (viewport.height - padding * 2) / bounds.height
    )
  );
  return {
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: viewport.height / 2 - (bounds.y + bounds.height / 2) * scale,
    scale,
  };
}

/** The smallest bounds containing every rectangle, or undefined for none. */
export function unionBounds(rects: Iterable<Bounds>): Bounds | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (minX === Infinity) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
