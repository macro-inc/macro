/**
 * Where the guest frame sits in the viewer, and how a point in the viewer maps
 * back to a guest pixel.
 *
 * Everything here is in CSS pixels of the viewer element. The frame is laid out
 * at its native size (one CSS pixel per guest pixel) and placed with one
 * transform: rotate by quarter turns, scale to fit times the local zoom, centre,
 * then pan. Device pixel ratio does not enter the mapping: pointer events and
 * layout share CSS pixels, and only the transport's backing store cares about
 * it.
 */

export type Point = { x: number; y: number };

export type Size = { width: number; height: number };

/** Clockwise quarter turns of the frame inside the viewer. */
export type Rotation = 0 | 90 | 180 | 270;

/** The local viewport: zoom relative to fit (1 = whole frame visible) and pan in CSS px. */
export type Viewport = { zoom: number; panX: number; panY: number };

export type ViewGeometry = {
  container: Size;
  frame: Size;
  rotation: Rotation;
};

export type FrameLayout = {
  /** CSS px per guest px. */
  scale: number;
  /** Top-left of the rotated, scaled frame in the container. */
  left: number;
  top: number;
  /** Size of the rotated, scaled frame. */
  width: number;
  height: number;
};

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export const FIT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };

function rotatedFrame(geometry: ViewGeometry): Size {
  const quarter = geometry.rotation === 90 || geometry.rotation === 270;
  if (quarter) {
    return { width: geometry.frame.height, height: geometry.frame.width };
  }
  return geometry.frame;
}

function fitScale(geometry: ViewGeometry): number {
  const rotated = rotatedFrame(geometry);
  if (rotated.width <= 0 || rotated.height <= 0) return 0;

  return Math.min(
    geometry.container.width / rotated.width,
    geometry.container.height / rotated.height
  );
}

export function layoutFrame(
  geometry: ViewGeometry,
  viewport: Viewport
): FrameLayout {
  const rotated = rotatedFrame(geometry);
  const scale = fitScale(geometry) * viewport.zoom;
  const width = rotated.width * scale;
  const height = rotated.height * scale;

  return {
    scale,
    width,
    height,
    left: (geometry.container.width - width) / 2 + viewport.panX,
    top: (geometry.container.height - height) / 2 + viewport.panY,
  };
}

export type Rect = { left: number; top: number; width: number; height: number };

/**
 * The part of the container the picture covers: the whole picture when it
 * fits, the container itself when zoomed past its edges. Chrome drawn around
 * the picture (its edge, the driving frame) follows this box.
 */
export function visibleFrameRect(
  geometry: ViewGeometry,
  viewport: Viewport
): Rect {
  const layout = layoutFrame(geometry, viewport);
  const left = Math.max(0, layout.left);
  const top = Math.max(0, layout.top);
  const right = Math.min(geometry.container.width, layout.left + layout.width);
  const bottom = Math.min(
    geometry.container.height,
    layout.top + layout.height
  );
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * The CSS transform for an element laid out at the frame's native size with
 * `transform-origin: 0 0` at the container's top-left.
 */
export function frameTransform(
  geometry: ViewGeometry,
  viewport: Viewport
): string {
  const layout = layoutFrame(geometry, viewport);
  const { width, height } = geometry.frame;
  const scaledWidth = width * layout.scale;
  const scaledHeight = height * layout.scale;

  // After rotating about the origin the frame's bounding box starts at a
  // negative offset; shift it back so its top-left is at (left, top).
  const shift: Record<Rotation, Point> = {
    0: { x: 0, y: 0 },
    90: { x: scaledHeight, y: 0 },
    180: { x: scaledWidth, y: scaledHeight },
    270: { x: 0, y: scaledWidth },
  };
  const offset = shift[geometry.rotation];

  return `translate(${layout.left + offset.x}px, ${layout.top + offset.y}px) rotate(${geometry.rotation}deg) scale(${layout.scale})`;
}

/**
 * The guest pixel under a viewer point, or `undefined` when the point is off
 * the frame (letterbox, or panned away). With `clamp`, a point off the frame
 * maps to the nearest edge pixel instead, for drags that leave it.
 */
export function toGuestPoint(
  geometry: ViewGeometry,
  viewport: Viewport,
  point: Point,
  clamp: boolean = false
): Point | undefined {
  const layout = layoutFrame(geometry, viewport);
  if (layout.scale <= 0) return undefined;

  // Position inside the rotated frame, in guest pixels.
  const u = (point.x - layout.left) / layout.scale;
  const v = (point.y - layout.top) / layout.scale;
  const rotated = rotatedFrame(geometry);
  const outside = u < 0 || v < 0 || u >= rotated.width || v >= rotated.height;
  if (outside && !clamp) return undefined;

  // Undo the clockwise rotation.
  const { width, height } = geometry.frame;
  const unrotated: Record<Rotation, Point> = {
    0: { x: u, y: v },
    90: { x: v, y: height - u },
    180: { x: width - u, y: height - v },
    270: { x: width - v, y: u },
  };
  const guest = unrotated[geometry.rotation];

  return {
    x: Math.min(width - 1, Math.max(0, Math.floor(guest.x))),
    y: Math.min(height - 1, Math.max(0, Math.floor(guest.y))),
  };
}

/**
 * Keeps the zoom in range and the frame covering the container where it can:
 * a frame larger than the container can't be panned past its edges, and one
 * smaller stays centred.
 */
export function clampViewport(
  geometry: ViewGeometry,
  viewport: Viewport
): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom));
  const layout = layoutFrame(geometry, { zoom, panX: 0, panY: 0 });
  const maxPanX = Math.max(0, (layout.width - geometry.container.width) / 2);
  const maxPanY = Math.max(0, (layout.height - geometry.container.height) / 2);

  return {
    zoom,
    panX: clampPan(viewport.panX, maxPanX),
    panY: clampPan(viewport.panY, maxPanY),
  };
}

/**
 * Zoomed until the picture covers the whole container, its top-left corner
 * in view: a landscape desktop in a portrait phone fills the view at a
 * readable size instead of a thin strip.
 */
export function fillViewport(geometry: ViewGeometry): Viewport {
  const rotated = rotatedFrame(geometry);
  const fit = fitScale(geometry);
  if (fit <= 0) return FIT_VIEWPORT;
  const cover = Math.max(
    geometry.container.width / rotated.width,
    geometry.container.height / rotated.height
  );
  // The largest pans keep the top-left corner at the container's.
  return clampViewport(geometry, {
    zoom: cover / fit,
    panX: Number.POSITIVE_INFINITY,
    panY: Number.POSITIVE_INFINITY,
  });
}

function clampPan(pan: number, limit: number): number {
  // Without room to pan the answer is exactly 0, never -0.
  if (limit === 0) return 0;
  return Math.min(limit, Math.max(-limit, pan));
}

/** Zooms by `factor` keeping the content under `focus` (a viewer point) in place. */
export function zoomAt(
  geometry: ViewGeometry,
  viewport: Viewport,
  factor: number,
  focus: Point
): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
  const applied = zoom / viewport.zoom;
  const centerX = geometry.container.width / 2;
  const centerY = geometry.container.height / 2;

  // The frame's centre sits at centre + pan; scaling about `focus` moves it
  // along the line from `focus` by the applied factor.
  const frameCenterX = centerX + viewport.panX;
  const frameCenterY = centerY + viewport.panY;
  const nextCenterX = focus.x + (frameCenterX - focus.x) * applied;
  const nextCenterY = focus.y + (frameCenterY - focus.y) * applied;

  return clampViewport(geometry, {
    zoom,
    panX: nextCenterX - centerX,
    panY: nextCenterY - centerY,
  });
}

export function panBy(
  geometry: ViewGeometry,
  viewport: Viewport,
  dx: number,
  dy: number
): Viewport {
  return clampViewport(geometry, {
    zoom: viewport.zoom,
    panX: viewport.panX + dx,
    panY: viewport.panY + dy,
  });
}

/** Where a guest pixel's centre sits in the viewer: the inverse of `toGuestPoint`. */
export function toViewerPoint(
  geometry: ViewGeometry,
  viewport: Viewport,
  guest: Point
): Point {
  const layout = layoutFrame(geometry, viewport);
  const { width, height } = geometry.frame;
  const x = guest.x + 0.5;
  const y = guest.y + 0.5;
  const rotated: Record<Rotation, Point> = {
    0: { x, y },
    90: { x: height - y, y: x },
    180: { x: width - x, y: height - y },
    270: { x: y, y: width - x },
  };
  const { x: u, y: v } = rotated[geometry.rotation];
  return {
    x: layout.left + u * layout.scale,
    y: layout.top + v * layout.scale,
  };
}

/** How close to the viewer's edge the guest pointer may get before the view follows it. */
export const POINTER_EDGE_MARGIN = 32;

/**
 * Pans the least distance that keeps a guest point (the guest's pointer) at
 * least `margin` inside the viewer, so it can't be dragged out of sight while
 * zoomed in. At fit there is nothing to pan, and the result is clamped.
 */
export function keepInView(
  geometry: ViewGeometry,
  viewport: Viewport,
  guest: Point,
  margin: number = POINTER_EDGE_MARGIN
): Viewport {
  if (viewport.zoom <= MIN_ZOOM) return viewport;
  const at = toViewerPoint(geometry, viewport, guest);
  const { width, height } = geometry.container;
  const shift = (position: number, size: number) => {
    const edge = Math.min(margin, size / 2);
    if (position < edge) return edge - position;
    if (position > size - edge) return size - edge - position;
    return 0;
  };
  const dx = shift(at.x, width);
  const dy = shift(at.y, height);
  if (dx === 0 && dy === 0) return viewport;
  return panBy(geometry, viewport, dx, dy);
}
