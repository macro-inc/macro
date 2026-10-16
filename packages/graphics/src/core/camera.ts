import type { Camera, Point } from './model';

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 8;
export const INITIAL_CAMERA: Camera = Object.freeze({ x: 0, y: 0, scale: 1 });

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
