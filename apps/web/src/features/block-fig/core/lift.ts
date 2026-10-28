/**
 * Moving layers by drawing them apart from the rest of the page.
 *
 * A move drag does not render the page again at every pointer move. The
 * engine's lift plan (`FigEngine.liftPlan`) splits the page into parts:
 * what paints below the moving layers, each run of them, and what paints
 * above each run. The parts render once, in tiles like the page, and every
 * frame composites them with the runs shifted by the drag's offset; the move
 * reaches the document once, at the drop.
 *
 * Only tiles a run covers, where it started or where it is now, are drawn
 * from the parts; elsewhere the page's own tiles are right. Of those, a tile
 * needs a render of the below part of its own only where a run started (its
 * pixels must go) or where something paints above a run (that must come out
 * from under the run); elsewhere the page's tile is the below part.
 */

import type { LayersSpec, LiftPlan, Rect } from '@core/fig-engine/types';
import type { Camera, Point, Size } from './camera';
import { TILE, type TileKey, tileRect, tilesFor, tileTouches } from './tiles';

export function offsetRect(r: Rect, d: Point): Rect {
  return { x: r.x + d.x, y: r.y + d.y, w: r.w, h: r.h };
}

function touchesAny(key: TileKey, rects: Rect[]): boolean {
  return rects.some((r) => tileTouches(key, r));
}

/** The renders of a lift's parts. */
export interface LiftParts {
  /**
   * The page without the moving layers, for page tiles rendered while they
   * are dragged (the document may move them meanwhile).
   */
  page: LayersSpec;
  /** What paints below the first run, on the page color. */
  below: LayersSpec;
  /** Each run by itself. */
  runs: LayersSpec[];
  /** What paints after each run and before the next one. */
  above: LayersSpec[];
}

export function liftParts(plan: LiftPlan): LiftParts {
  const runs = plan.runs;
  return {
    page: { skip: runs.flatMap((r) => r.ids) },
    below: { before: runs[0].ids[0] },
    // Anchored: the document may move the layers while they are dragged.
    runs: runs.map((r) => ({ only: r.ids, anchor: [r.origin.x, r.origin.y] })),
    above: runs.map((r, k) => ({
      after: r.ids[r.ids.length - 1],
      before: runs[k + 1]?.ids[0] ?? null,
    })),
  };
}

/** A tile of the view drawn from a lift's parts. */
export interface LiftTile {
  key: TileKey;
  /** Drawn from a render of the below part (else the page's tile). */
  below: boolean;
  /** The runs whose above part it draws. */
  above: number[];
}

/**
 * The view's tiles at `scale` drawn from a lift's parts: those a run covers
 * where it started or where it is now, moved by `offset`.
 */
export function liftTiles(
  plan: LiftPlan,
  offset: Point,
  camera: Camera,
  viewport: Size,
  scale: number
): LiftTile[] {
  const started = plan.runs.map((r) => r.bounds);
  const now = started.map((b) => offsetRect(b, offset));
  const tiles: LiftTile[] = [];
  for (const key of tilesFor(camera, viewport, scale, 0)) {
    const home = touchesAny(key, started);
    if (!home && !touchesAny(key, now)) continue;
    const above = plan.runs.flatMap((r, k) =>
      touchesAny(key, r.above) ? [k] : []
    );
    tiles.push({ key, below: home || above.length > 0, above });
  }
  return tiles;
}

/**
 * The tiles of a run's own render, at the place it started, that show in the
 * view while it is moved by `offset`.
 */
export function runTiles(
  bounds: Rect,
  offset: Point,
  camera: Camera,
  viewport: Size,
  scale: number
): TileKey[] {
  // Moved back by the offset, the view covers what of the run shows.
  const back = { ...camera, x: camera.x - offset.x, y: camera.y - offset.y };
  return tilesFor(back, viewport, scale, 0).filter((key) =>
    tileTouches(key, bounds)
  );
}

/** Device pixels of a tile, from its top-left corner. */
export interface Patch {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The part of a tile that page rectangles cover, in its device pixels, with
 * a pixel to spare for anti-aliasing; `undefined` when they miss it. A
 * lift's parts differ from the page only there, so only that much renders.
 */
export function tilePatch(key: TileKey, rects: Rect[]): Patch | undefined {
  const t = tileRect(key);
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    const ax = Math.max(r.x, t.x);
    const ay = Math.max(r.y, t.y);
    const bx = Math.min(r.x + r.w, t.x + t.w);
    const by = Math.min(r.y + r.h, t.y + t.h);
    if (bx <= ax || by <= ay) continue;
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
  }
  if (x0 > x1) return undefined;
  // Outward to whole device pixels, then one more, within the tile.
  const start = (v: number) => Math.max(0, Math.floor(v * key.scale) - 1);
  const end = (v: number) => Math.min(TILE, Math.ceil(v * key.scale) + 1);
  const left = start(x0 - t.x);
  const top = start(y0 - t.y);
  const right = end(x1 - t.x);
  const bottom = end(y1 - t.y);
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, w: right - left, h: bottom - top };
}
