/**
 * Tile math. The engine rasterizes the page in square tiles of device
 * pixels at a given scale (device pixels per page unit); tile `(ix, iy)` at
 * scale `s` covers page units `[ix·T/s, (ix+1)·T/s)` horizontally.
 */

import type { Rect } from '@core/fig-engine/types';
import type { Camera, Size } from './camera';

/** Tile side in device pixels. */
export const TILE = 512;

export interface TileKey {
  scale: number;
  ix: number;
  iy: number;
}

/**
 * Render scales are quantized so tiles for nearly equal zooms are shared;
 * the step (0.1%) is below what a rendered tile can show.
 */
export function quantizeScale(scale: number): number {
  const exponent = Math.floor(Math.log10(scale));
  const unit = 10 ** (exponent - 3);
  return Math.round(scale / unit) * unit;
}

export function tileId(key: TileKey): string {
  return `${key.scale}:${key.ix}:${key.iy}`;
}

/** The page rectangle a tile covers. */
export function tileRect(key: TileKey): Rect {
  const side = TILE / key.scale;
  return { x: key.ix * side, y: key.iy * side, w: side, h: side };
}

/**
 * Tiles at `scale` covering the viewport plus `margin` tiles around it,
 * nearest the viewport's center first.
 */
export function tilesFor(
  camera: Camera,
  viewport: Size,
  scale: number,
  margin = 0
): TileKey[] {
  const side = TILE / scale;
  const x0 = Math.floor(camera.x / side) - margin;
  const y0 = Math.floor(camera.y / side) - margin;
  const x1 = Math.floor((camera.x + viewport.w / camera.zoom) / side) + margin;
  const y1 = Math.floor((camera.y + viewport.h / camera.zoom) / side) + margin;
  const cx = (camera.x + viewport.w / camera.zoom / 2) / side - 0.5;
  const cy = (camera.y + viewport.h / camera.zoom / 2) / side - 0.5;
  const keys: TileKey[] = [];
  // A pathological camera must not request millions of tiles.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return keys;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) keys.push({ scale, ix, iy });
  }
  keys.sort(
    (a, b) =>
      (a.ix - cx) ** 2 +
      (a.iy - cy) ** 2 -
      ((b.ix - cx) ** 2 + (b.iy - cy) ** 2)
  );
  return keys;
}

/** Whether a tile intersects a page rectangle (content bounds). */
export function tileTouches(key: TileKey, rect: Rect): boolean {
  const t = tileRect(key);
  return (
    t.x < rect.x + rect.w &&
    rect.x < t.x + t.w &&
    t.y < rect.y + rect.h &&
    rect.y < t.y + t.h
  );
}

/** Side of a coverage cell, in device pixels. */
const CELL = 32;

/**
 * What opaque drawing already covers on a canvas, in cells of `CELL` device
 * pixels. Drawing tiles sharpest first, a coarser tile can be skipped when
 * sharper ones cover everything it would show.
 */
export function createCoverage(width: number, height: number) {
  const cols = Math.max(1, Math.ceil(width / CELL));
  const rows = Math.max(1, Math.ceil(height / CELL));
  const cells = new Uint8Array(cols * rows);
  /** The cells a rectangle touches, or (`whole`) lies over entirely. */
  const span = (x: number, y: number, w: number, h: number, whole: boolean) => {
    const start = whole ? Math.ceil : Math.floor;
    const end = whole ? Math.floor : Math.ceil;
    return {
      c0: Math.max(0, start(x / CELL)),
      r0: Math.max(0, start(y / CELL)),
      c1: Math.min(cols, end((x + w) / CELL)),
      r1: Math.min(rows, end((y + h) / CELL)),
    };
  };
  return {
    /** Whether everything a rectangle would show is covered already. */
    covers(x: number, y: number, w: number, h: number): boolean {
      const { c0, r0, c1, r1 } = span(x, y, w, h, false);
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) if (!cells[r * cols + c]) return false;
      }
      return true;
    },
    /** Records an opaque rectangle (the cells it lies over entirely). */
    add(x: number, y: number, w: number, h: number) {
      const { c0, r0, c1, r1 } = span(x, y, w, h, true);
      if (c1 <= c0) return;
      for (let r = r0; r < r1; r++) cells.fill(1, r * cols + c0, r * cols + c1);
    },
    /** Records everything outside a rectangle (where nothing is drawn). */
    addOutside(x: number, y: number, w: number, h: number) {
      const { c0, r0, c1, r1 } = span(x, y, w, h, false);
      for (let r = 0; r < rows; r++) {
        if (r < r0 || r >= r1 || c1 <= c0) {
          cells.fill(1, r * cols, (r + 1) * cols);
        } else {
          cells.fill(1, r * cols, r * cols + c0);
          cells.fill(1, r * cols + c1, (r + 1) * cols);
        }
      }
    },
  };
}
