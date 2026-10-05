/**
 * Fitting canvas areas into the window around the editor's floating
 * controls: the toolbar on the left and the status bar at the bottom.
 */

import {
  type Camera,
  clampZoom,
  MAX_ZOOM,
  type Size,
} from '@app/features/block-fig/core/camera';
import type { Rect } from './geometry';

/** Room the floating controls take from each side of the canvas (CSS px). */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The toolbar (left), artboard names (top), and status bar (bottom). */
export const CONTROL_INSETS: Insets = {
  left: 64,
  right: 0,
  top: 16,
  bottom: 52,
};

/** Margin around what is fitted, inside the insets (CSS px). */
const FIT_MARGIN = 32;

/**
 * The camera that shows `rect` as large as fits (up to `maxZoom`),
 * centered in the part of the viewport the controls leave free.
 */
export function fitInside(
  rect: Rect,
  viewport: Size,
  insets: Insets = CONTROL_INSETS,
  maxZoom = MAX_ZOOM
): Camera {
  const w = Math.max(rect.w, 1e-6);
  const h = Math.max(rect.h, 1e-6);
  const freeW = Math.max(viewport.w - insets.left - insets.right, 1);
  const freeH = Math.max(viewport.h - insets.top - insets.bottom, 1);
  const zoom = clampZoom(
    Math.min(
      Math.max(freeW - 2 * FIT_MARGIN, 1) / w,
      Math.max(freeH - 2 * FIT_MARGIN, 1) / h,
      maxZoom
    )
  );
  const cx = insets.left + freeW / 2;
  const cy = insets.top + freeH / 2;
  return { zoom, x: rect.x + w / 2 - cx / zoom, y: rect.y + h / 2 - cy / zoom };
}
