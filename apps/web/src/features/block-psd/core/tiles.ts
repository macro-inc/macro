/**
 * Tile math. The engine composites the canvas at mip levels: level `L` is
 * the canvas scaled by `1/2^L` (rounding outward), and the editor asks for
 * it in square tiles of `TILE` level pixels. Tile `(ix, iy)` at level `L`
 * covers level pixels `[ix·T, (ix+1)·T)`, which are canvas pixels
 * `[ix·T·2^L, (ix+1)·T·2^L)`; grids of different levels nest, so a tile
 * is exactly four tiles of the level below.
 *
 * Tiles are transparent where the document is, so a screen cell is drawn
 * from exactly one source (never a coarse tile under a sharp one, which
 * would show through).
 */

import type { IRect } from '@core/psd-engine/types';

/** Tile side, in level pixels. */
export const TILE = 512;

/** The coarsest level the engine renders. */
const MAX_LEVEL = 16;

export interface TileKey {
  level: number;
  ix: number;
  iy: number;
}

export interface DocSize {
  width: number;
  height: number;
}

export const tileId = (k: TileKey) => `${k.level}:${k.ix}:${k.iy}`;

/**
 * The level whose pixels are no coarser than the screen's at `deviceScale`
 * (device pixels per canvas pixel): the sharpest that still downscales.
 * Magnified views use level 0.
 */
export function levelFor(deviceScale: number): number {
  if (!(deviceScale > 0) || deviceScale >= 1) return 0;
  return Math.min(MAX_LEVEL, Math.floor(Math.log2(1 / deviceScale) + 1e-9));
}

/** A canvas length at a level (rounding outward, as the engine does). */
export function levelSize(length: number, level: number): number {
  return Math.ceil(length / 2 ** level);
}

/** The level whose whole canvas fits in `side` pixels (the overview). */
export function overviewLevel(doc: DocSize, side: number): number {
  let level = 0;
  while (
    level < MAX_LEVEL &&
    Math.max(levelSize(doc.width, level), levelSize(doc.height, level)) > side
  )
    level++;
  return level;
}

/** The level pixels a tile covers, within the canvas (empty outside it). */
export function tileLevelRect(key: TileKey, doc: DocSize): IRect {
  const w = levelSize(doc.width, key.level);
  const h = levelSize(doc.height, key.level);
  const x0 = Math.max(0, key.ix * TILE);
  const y0 = Math.max(0, key.iy * TILE);
  const x1 = Math.min(w, (key.ix + 1) * TILE);
  const y1 = Math.min(h, (key.iy + 1) * TILE);
  return {
    x: x0,
    y: y0,
    w: Math.max(0, x1 - x0),
    h: Math.max(0, y1 - y0),
  };
}

/** A level rectangle in canvas pixels. */
function levelToCanvas(rect: IRect, level: number): IRect {
  const s = 2 ** level;
  return { x: rect.x * s, y: rect.y * s, w: rect.w * s, h: rect.h * s };
}

/** A canvas rectangle in level pixels (rounding outward). */
export function canvasToLevel(rect: IRect, level: number): IRect {
  const s = 2 ** level;
  const x0 = Math.floor(rect.x / s);
  const y0 = Math.floor(rect.y / s);
  const x1 = Math.ceil((rect.x + rect.w) / s);
  const y1 = Math.ceil((rect.y + rect.h) / s);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersect(a: IRect, b: IRect): IRect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function union(a: IRect, b: IRect): IRect {
  if (a.w <= 0 || a.h <= 0) return b;
  if (b.w <= 0 || b.h <= 0) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return {
    x: x0,
    y: y0,
    w: Math.max(a.x + a.w, b.x + b.w) - x0,
    h: Math.max(a.y + a.h, b.y + b.h) - y0,
  };
}

export const isEmpty = (r: IRect) => r.w <= 0 || r.h <= 0;

/**
 * Tiles at `level` covering a canvas rectangle, plus `margin` tiles
 * around it, within the canvas; nearest the rectangle's center first.
 */
export function tilesFor(
  view: IRect,
  level: number,
  doc: DocSize,
  margin = 0
): TileKey[] {
  const side = TILE * 2 ** level;
  const nx = Math.ceil(levelSize(doc.width, level) / TILE);
  const ny = Math.ceil(levelSize(doc.height, level) / TILE);
  const x0 = Math.max(0, Math.floor(view.x / side) - margin);
  const y0 = Math.max(0, Math.floor(view.y / side) - margin);
  const x1 = Math.min(nx - 1, Math.ceil((view.x + view.w) / side) - 1 + margin);
  const y1 = Math.min(ny - 1, Math.ceil((view.y + view.h) / side) - 1 + margin);
  const keys: TileKey[] = [];
  // A pathological view must not request millions of tiles.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return keys;
  const cx = (view.x + view.w / 2) / side - 0.5;
  const cy = (view.y + view.h / 2) / side - 0.5;
  for (let iy = y0; iy <= y1; iy++)
    for (let ix = x0; ix <= x1; ix++) keys.push({ level, ix, iy });
  keys.sort(
    (a, b) =>
      (a.ix - cx) ** 2 +
      (a.iy - cy) ** 2 -
      ((b.ix - cx) ** 2 + (b.iy - cy) ** 2)
  );
  return keys;
}

/** Whether a tile's canvas area meets a canvas rectangle. */
export function tileTouches(key: TileKey, rect: IRect): boolean {
  const side = TILE * 2 ** key.level;
  return (
    key.ix * side < rect.x + rect.w &&
    rect.x < (key.ix + 1) * side &&
    key.iy * side < rect.y + rect.h &&
    rect.y < (key.iy + 1) * side
  );
}

/**
 * Where a screen cell (a tile at the view's level) is drawn from, given
 * which tiles have pixels: the tile itself; else its four children one
 * level finer when all those inside the canvas have pixels (zooming out
 * keeps the sharp tiles); else the nearest coarser tile that has pixels.
 * Empty when nothing covers it yet.
 */
export function cellSources(
  cell: TileKey,
  doc: DocSize,
  has: (key: TileKey) => boolean,
  coarsest = MAX_LEVEL
): TileKey[] {
  if (has(cell)) return [cell];
  if (cell.level > 0) {
    const children: TileKey[] = [];
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const child = {
        level: cell.level - 1,
        ix: cell.ix * 2 + dx,
        iy: cell.iy * 2 + dy,
      };
      if (!isEmpty(tileLevelRect(child, doc))) children.push(child);
    }
    if (children.length > 0 && children.every(has)) return children;
  }
  for (let level = cell.level + 1; level <= coarsest; level++) {
    const shift = level - cell.level;
    const parent = {
      level,
      ix: Math.floor(cell.ix / 2 ** shift),
      iy: Math.floor(cell.iy / 2 ** shift),
    };
    if (has(parent)) return [parent];
  }
  return [];
}

/**
 * The part of `source` (a tile with pixels) to draw for `cell`: the
 * rectangle in the tile's own pixels, and where it goes on the canvas.
 */
export function sourceRegion(
  source: TileKey,
  cell: TileKey,
  doc: DocSize
): { from: IRect; to: IRect } | undefined {
  const canvas = { x: 0, y: 0, w: doc.width, h: doc.height };
  const cellArea = intersect(
    levelToCanvas(tileLevelRect(cell, doc), cell.level),
    canvas
  );
  const sourceLevel = tileLevelRect(source, doc);
  const sourceArea = levelToCanvas(sourceLevel, source.level);
  const to = intersect(cellArea, sourceArea);
  if (isEmpty(to)) return undefined;
  const s = 2 ** source.level;
  return {
    from: {
      x: (to.x - sourceArea.x) / s,
      y: (to.y - sourceArea.y) / s,
      w: to.w / s,
      h: to.h / s,
    },
    to,
  };
}
