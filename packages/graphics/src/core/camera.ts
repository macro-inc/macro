import type { Camera, Point } from './model';

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 8;
export const INITIAL_CAMERA: Camera = Object.freeze({ x: 0, y: 0, scale: 1 });

/**
 * The view a fit works in: its size, and optionally the part of it that
 * controls cover and the margin to leave.
 */
export type FitViewport = {
  width: number;
  height: number;
  /**
   * Screen pixels at each side that something covers (a header, a toolbar, a
   * panel). The content is fitted to and centred in what is left.
   */
  inset?: { top?: number; right?: number; bottom?: number; left?: number };
  /**
   * Screen pixels kept clear around the content. Without it the margin is
   * 100px, and either way never more than a quarter of the room.
   */
  padding?: number;
};

/** The camera that shows `bounds` whole, as large as the view's room allows. */
export function fitBoundsCamera(
  bounds: { x: number; y: number; width: number; height: number },
  viewport: FitViewport
): Camera | undefined {
  const left = Math.max(0, viewport.inset?.left ?? 0);
  const top = Math.max(0, viewport.inset?.top ?? 0);
  const width = viewport.width - left - Math.max(0, viewport.inset?.right ?? 0);
  const height =
    viewport.height - top - Math.max(0, viewport.inset?.bottom ?? 0);
  if (
    (bounds.width <= 0 && bounds.height <= 0) ||
    ![width, height].every((size) => Number.isFinite(size) && size > 0)
  )
    return undefined;
  // Screen-space margins; leave usable room even in a small embedded view.
  const padding = Math.min(viewport.padding ?? 100, width / 4, height / 4);
  const scale = Math.max(
    MIN_SCALE,
    Math.min(
      MAX_SCALE,
      (width - padding * 2) / bounds.width,
      (height - padding * 2) / bounds.height
    )
  );
  return {
    scale,
    x: left + (width - bounds.width * scale) / 2 - bounds.x * scale,
    y: top + (height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

export function fitImageCamera(
  image: { width: number; height: number },
  viewport: { width: number; height: number }
): Camera {
  if (
    ![image.width, image.height, viewport.width, viewport.height].every(
      (value) => Number.isFinite(value) && value > 0
    )
  )
    return INITIAL_CAMERA;
  const scale = Math.max(
    MIN_SCALE,
    Math.min(
      1,
      (viewport.width - Math.min(48, viewport.width / 4)) / image.width,
      (viewport.height - Math.min(48, viewport.height / 4)) / image.height
    )
  );
  return {
    x: (viewport.width - image.width * scale) / 2,
    y: (viewport.height - image.height * scale) / 2,
    scale,
  };
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return {
    x: point.x * camera.scale + camera.x,
    y: point.y * camera.scale + camera.y,
  };
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  };
}

export function zoomAt(
  camera: Camera,
  anchor: Point,
  requestedScale: number
): Camera {
  if (
    !Number.isFinite(requestedScale) ||
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y)
  )
    return camera;
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, requestedScale));
  const world = screenToWorld(camera, anchor);
  return {
    x: anchor.x - world.x * scale,
    y: anchor.y - world.y * scale,
    scale,
  };
}
