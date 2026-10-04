/**
 * Tiled rendering of the canvas.
 *
 * The engine rasterizes the page in fixed-size tiles at a given scale; this
 * keeps a cache of them and draws whatever is available onto a 2D canvas.
 * Drawing never waits for rendering: coarse tiles stand in, scaled, until
 * sharp ones arrive, as in Figma.
 *
 * - An overview of the whole page (a few tiles at a small scale) is pinned
 *   and is the fallback everywhere.
 * - Panning reuses tiles at the current scale and fetches new ones at the
 *   edges (plus a margin, to stay ahead of the pan).
 * - While zoom changes, nothing is fetched at each intermediate scale;
 *   tiles at the nearest lower power of two keep the view reasonably sharp
 *   during long gestures, and exact-scale tiles are fetched once the view
 *   settles.
 * - Requests that fall out of view before they start are cancelled.
 */

import type {
  FigEngine,
  PendingTile,
  TileResult,
} from '@core/fig-engine/client';
import type { Rect } from '@core/fig-engine/types';
import type { Camera, Size } from '../core/camera';
import {
  quantizeScale,
  TILE,
  type TileKey,
  tileId,
  tileRect,
  tilesFor,
  tileTouches,
} from '../core/tiles';

interface Entry {
  key: TileKey;
  bitmap?: ImageBitmap;
  pending?: PendingTile;
  lastUsed: number;
  pinned: boolean;
}

export interface TileCompositorOptions {
  engine: FigEngine;
  /** Called when a tile arrives (the canvas should redraw). */
  onTile: () => void;
  /** Tiles kept besides the overview (each is TILE² × 4 bytes). */
  budget?: number;
}

export interface ViewState {
  camera: Camera;
  /** Canvas size in CSS pixels. */
  viewport: Size;
  dpr: number;
}

export interface PageState {
  page: number;
  outline: boolean;
  /** Bounds of the page's content (tiles elsewhere are blank). */
  content: Rect | undefined;
  /** CSS color of the page canvas. */
  background: string;
}

/** Longest side of the overview, in device pixels. */
const OVERVIEW_SIDE = 2048;
/** Quiet time after which the view counts as settled. */
const SETTLE_MS = 140;

export function createTileCompositor(options: TileCompositorOptions) {
  const { engine } = options;
  const budget = options.budget ?? 160;
  const cache = new Map<string, Entry>();
  let page: PageState | undefined;
  let generation = 0;
  let clock = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let lastView: ViewState | undefined;
  let lastZoom = 0;
  let zoomChangedAt = 0;
  let disposed = false;
  /** Render timings, for diagnostics. */
  const stats = { rendered: 0, millis: 0 };

  const evict = () => {
    const live = [...cache.values()].filter((e) => !e.pinned && e.bitmap);
    if (live.length <= budget) return;
    live.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of live.slice(0, live.length - budget)) {
      e.bitmap?.close();
      cache.delete(tileId(e.key));
    }
  };

  const request = (key: TileKey, priority: number, pinned = false) => {
    if (!page) return;
    const id = tileId(key);
    const existing = cache.get(id);
    if (existing) {
      existing.lastUsed = ++clock;
      existing.pinned ||= pinned;
      return;
    }
    if (page.content && !tileTouches(key, page.content)) return;
    const rect = tileRect(key);
    const pending = engine.render({
      page: page.page,
      x: rect.x,
      y: rect.y,
      scale: key.scale,
      width: TILE,
      height: TILE,
      outline: page.outline,
      priority,
    });
    const entry: Entry = { key, pending, lastUsed: ++clock, pinned };
    cache.set(id, entry);
    const forGeneration = generation;
    pending.promise
      .then((result: TileResult | null) => {
        if (!result) {
          // Cancelled before it started.
          if (cache.get(id) === entry) cache.delete(id);
          return;
        }
        if (
          disposed ||
          forGeneration !== generation ||
          cache.get(id) !== entry
        ) {
          result.bitmap.close();
          return;
        }
        entry.bitmap = result.bitmap;
        entry.pending = undefined;
        stats.rendered++;
        stats.millis += result.millis;
        evict();
        options.onTile();
      })
      .catch(() => {
        if (cache.get(id) === entry) cache.delete(id);
      });
  };

  const overviewScale = () => {
    const c = page?.content;
    if (!c || !(c.w > 0 && c.h > 0)) return undefined;
    return quantizeScale(Math.min(OVERVIEW_SIDE / Math.max(c.w, c.h), 64));
  };

  const requestOverview = () => {
    const scale = overviewScale();
    const c = page?.content;
    if (!scale || !c) return;
    const side = TILE / scale;
    for (let iy = Math.floor(c.y / side); iy * side < c.y + c.h; iy++) {
      for (let ix = Math.floor(c.x / side); ix * side < c.x + c.w; ix++) {
        request({ scale, ix, iy }, -1, true);
      }
    }
  };

  /** Cancels queued renders the current view no longer needs. */
  const prune = (wanted: Set<string>) => {
    const cancel: number[] = [];
    for (const [id, e] of cache) {
      if (e.pending && !e.pinned && !wanted.has(id)) {
        cancel.push(e.pending.id);
        cache.delete(id);
      }
    }
    engine.cancel(cancel);
  };

  const schedule = (view: ViewState, settled: boolean) => {
    if (!page) return;
    const target = quantizeScale(view.camera.zoom * view.dpr);
    const wanted = new Set<string>();
    let priority = 0;
    const want = (scale: number, margin: number) => {
      for (const key of tilesFor(view.camera, view.viewport, scale, margin)) {
        wanted.add(tileId(key));
        request(key, priority++);
      }
    };
    const zooming = view.camera.zoom !== lastZoom;
    if (zooming) {
      lastZoom = view.camera.zoom;
      zoomChangedAt = performance.now();
    }
    const zoomQuiet = performance.now() - zoomChangedAt > SETTLE_MS;
    if (settled || zoomQuiet) {
      want(target, settled ? 1 : 0);
    } else {
      // Mid-zoom: a power-of-two scale at or below the target, reused
      // across a range of zooms.
      const coarse = quantizeScale(2 ** Math.floor(Math.log2(target)));
      want(coarse, 0);
    }
    prune(wanted);
  };

  return {
    stats,

    /** Starts over for a page (or after switching outline view). */
    setPage(next: PageState) {
      for (const e of cache.values()) {
        e.bitmap?.close();
        if (e.pending) engine.cancel([e.pending.id]);
      }
      cache.clear();
      generation++;
      page = next;
      requestOverview();
      if (lastView) schedule(lastView, true);
    },

    /** Call on every view change; fetches what the view needs. */
    update(view: ViewState) {
      lastView = view;
      schedule(view, false);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (lastView && !disposed) schedule(lastView, true);
      }, SETTLE_MS);
    },

    /** Draws the view from the tiles available now. */
    draw(ctx: CanvasRenderingContext2D, view: ViewState) {
      const { camera, dpr } = view;
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      ctx.fillStyle = page?.background ?? '#f5f5f5';
      ctx.fillRect(0, 0, width, height);
      if (!page) return;
      const target = quantizeScale(camera.zoom * dpr);
      const unit = camera.zoom * dpr;
      // Coarse scales first, then sharper ones on top; far sharper tiles
      // are skipped (too many, and the overview covers them).
      const scales = new Set<number>();
      for (const e of cache.values()) if (e.bitmap) scales.add(e.key.scale);
      const ordered = [...scales]
        .filter((s) => s <= target * 4)
        .sort((a, b) => {
          // Exact matches last; otherwise ascending.
          if (a === target) return 1;
          if (b === target) return -1;
          return a - b;
        });
      const viewW = view.viewport.w / camera.zoom;
      const viewH = view.viewport.h / camera.zoom;
      for (const scale of ordered) {
        const exact = scale === target;
        ctx.imageSmoothingEnabled = !exact;
        ctx.imageSmoothingQuality = 'high';
        for (const e of cache.values()) {
          if (!e.bitmap || e.key.scale !== scale) continue;
          const r = tileRect(e.key);
          if (
            r.x > camera.x + viewW ||
            r.x + r.w < camera.x ||
            r.y > camera.y + viewH ||
            r.y + r.h < camera.y
          )
            continue;
          e.lastUsed = ++clock;
          let x = (r.x - camera.x) * unit;
          let y = (r.y - camera.y) * unit;
          let size = r.w * unit;
          if (exact) {
            // Pixel-aligned at the exact scale: a 1:1 copy, perfectly crisp,
            // and positioned from the tile grid so neighbors never gap.
            x = e.key.ix * TILE - Math.round(camera.x * scale);
            y = e.key.iy * TILE - Math.round(camera.y * scale);
            size = TILE;
          }
          ctx.drawImage(e.bitmap, x, y, size, size);
        }
      }
    },

    /** Whether every tile the settled view needs is drawn sharp. */
    isSharp(view: ViewState): boolean {
      const target = quantizeScale(view.camera.zoom * view.dpr);
      return tilesFor(view.camera, view.viewport, target, 0).every((key) => {
        if (page?.content && !tileTouches(key, page.content)) return true;
        return !!cache.get(tileId(key))?.bitmap;
      });
    },

    dispose() {
      disposed = true;
      clearTimeout(settleTimer);
      for (const e of cache.values()) {
        e.bitmap?.close();
        if (e.pending) engine.cancel([e.pending.id]);
      }
      cache.clear();
    },
  };
}

export type TileCompositor = ReturnType<typeof createTileCompositor>;
