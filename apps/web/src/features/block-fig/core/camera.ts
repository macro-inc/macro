/**
 * The viewport camera: which page point sits at the canvas's top-left
 * corner, and how many CSS pixels one page unit spans (100% zoom = 1).
 */

import type { Rect } from '@core/fig-engine/types';

export interface Camera {
  /** Page coordinates at the canvas's top-left corner. */
  x: number;
  y: number;
  /** CSS pixels per page unit. */
  zoom: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Figma's zoom range: 1% to 25600%. */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 256;

export const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export function screenToPage(camera: Camera, p: Point): Point {
  return { x: camera.x + p.x / camera.zoom, y: camera.y + p.y / camera.zoom };
}

export function pageToScreen(camera: Camera, p: Point): Point {
  return {
    x: (p.x - camera.x) * camera.zoom,
    y: (p.y - camera.y) * camera.zoom,
  };
}

/** Zooms to `zoom`, keeping the page point under `anchor` (screen) fixed. */
export function zoomAt(camera: Camera, zoom: number, anchor: Point): Camera {
  const z = clampZoom(zoom);
  const page = screenToPage(camera, anchor);
  return { x: page.x - anchor.x / z, y: page.y - anchor.y / z, zoom: z };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    x: camera.x - dx / camera.zoom,
    y: camera.y - dy / camera.zoom,
  };
}

/** Margin around content when zooming to fit, in CSS pixels. */
const FIT_PADDING = 48;

/**
 * Frames `rect` in the viewport. Zooming to fit never magnifies small
 * content beyond `maxZoom` (Figma stops at 100% for selections that fit).
 */
export function fitRect(
  rect: Rect,
  viewport: Size,
  maxZoom = MAX_ZOOM
): Camera {
  const w = Math.max(rect.w, 1e-6);
  const h = Math.max(rect.h, 1e-6);
  const availableW = Math.max(viewport.w - 2 * FIT_PADDING, 1);
  const availableH = Math.max(viewport.h - 2 * FIT_PADDING, 1);
  const zoom = clampZoom(Math.min(availableW / w, availableH / h, maxZoom));
  return {
    zoom,
    x: rect.x + w / 2 - viewport.w / 2 / zoom,
    y: rect.y + h / 2 - viewport.h / 2 / zoom,
  };
}

/** Centers `rect` without changing the zoom. */
export function centerOn(camera: Camera, rect: Rect, viewport: Size): Camera {
  return {
    zoom: camera.zoom,
    x: rect.x + rect.w / 2 - viewport.w / 2 / camera.zoom,
    y: rect.y + rect.h / 2 - viewport.h / 2 / camera.zoom,
  };
}

/** The page rectangle the viewport shows. */
export function visibleRect(camera: Camera, viewport: Size): Rect {
  return {
    x: camera.x,
    y: camera.y,
    w: viewport.w / camera.zoom,
    h: viewport.h / camera.zoom,
  };
}

/** Keyboard zoom steps double or halve, snapping to powers of two. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const exponent = Math.log2(zoom);
  const snapped =
    direction > 0
      ? Math.floor(exponent + 1e-6) + 1
      : Math.ceil(exponent - 1e-6) - 1;
  return clampZoom(2 ** snapped);
}

/** Zoom as Figma shows it: `100%`, `33%`, `0.5%`. */
export function zoomLabel(zoom: number): string {
  const percent = zoom * 100;
  if (percent < 1) return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
  return `${Math.round(percent)}%`;
}

/** Union of rectangles (`undefined` for none). */
export function unionRects(rects: Rect[]): Rect | undefined {
  let out: Rect | undefined;
  for (const r of rects) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.w) || r.w < 0) continue;
    if (!out) {
      out = { ...r };
      continue;
    }
    const x = Math.min(out.x, r.x);
    const y = Math.min(out.y, r.y);
    out = {
      x,
      y,
      w: Math.max(out.x + out.w, r.x + r.w) - x,
      h: Math.max(out.y + out.h, r.y + r.h) - y,
    };
  }
  return out;
}
