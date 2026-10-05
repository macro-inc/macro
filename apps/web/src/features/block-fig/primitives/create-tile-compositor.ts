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
 * - After an edit, tiles in the changed area are re-rendered while the old
 *   ones stay on screen, so editing never flashes. Only the tiles in view
 *   are re-rendered at once; the margin's and the overview's wait until
 *   edits pause (and then behind the view's), so a drag does not re-render
 *   the whole page at every step.
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
  tilesCover,
  tilesFor,
  tileTouches,
} from '../core/tiles';

interface Entry {
  key: TileKey;
  bitmap?: ImageBitmap;
  pending?: PendingTile;
  /** The bitmap predates an edit in its area: shown until replaced. */
  stale?: boolean;
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
/** Quiet time after an edit before tiles out of view are re-rendered. */
const EDIT_SETTLE_MS = 300;
/** Priority of overview tiles changed by an edit: after every view tile. */
const AFTER_VIEW = Number.MAX_SAFE_INTEGER;

export function createTileCompositor(options: TileCompositorOptions) {
  const { engine } = options;
  const budget = options.budget ?? 160;
  const cache = new Map<string, Entry>();
  let page: PageState | undefined;
  let generation = 0;
  let clock = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let editTimer: ReturnType<typeof setTimeout> | undefined;
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

  const render = (entry: Entry, priority: number) => {
    if (!page) return;
    const rect = tileRect(entry.key);
    const pending = engine.render({
      page: page.page,
      x: rect.x,
      y: rect.y,
      scale: entry.key.scale,
      width: TILE,
      height: TILE,
      outline: page.outline,
      priority,
    });
    entry.pending = pending;
    const id = tileId(entry.key);
    const forGeneration = generation;
    pending.promise
      .then((result: TileResult | null) => {
        // Superseded (an edit re-requested it) or cancelled.
        const current = entry.pending?.id === pending.id;
        if (!result) {
          if (current) {
            entry.pending = undefined;
            if (!entry.bitmap && cache.get(id) === entry) cache.delete(id);
          }
          return;
        }
        if (
          disposed ||
          !current ||
          forGeneration !== generation ||
          cache.get(id) !== entry
        ) {
          result.bitmap.close();
          return;
        }
        entry.bitmap?.close();
        entry.bitmap = result.bitmap;
        entry.pending = undefined;
        entry.stale = false;
        stats.rendered++;
        stats.millis += result.millis;
        evict();
        options.onTile();
      })
      .catch(() => {
        if (entry.pending?.id !== pending.id) return;
        entry.pending = undefined;
        if (!entry.bitmap && cache.get(id) === entry) cache.delete(id);
      });
  };

  const request = (key: TileKey, priority: number, pinned = false) => {
    if (!page) return;
    const id = tileId(key);
    const existing = cache.get(id);
    if (existing) {
      existing.lastUsed = ++clock;
      existing.pinned ||= pinned;
      if (existing.stale && !existing.pending) render(existing, priority);
      return;
    }
    if (page.content && !tileTouches(key, page.content)) return;
    const entry: Entry = { key, lastUsed: ++clock, pinned };
    cache.set(id, entry);
    render(entry, priority);
  };

  const overviewScale = () => {
    const c = page?.content;
    if (!c || !(c.w > 0 && c.h > 0)) return undefined;
    return quantizeScale(Math.min(OVERVIEW_SIDE / Math.max(c.w, c.h), 64));
  };

  /** The overview's tiles, first of all unless `priority` says otherwise. */
  const requestOverview = (priority = -1) => {
    const scale = overviewScale();
    const c = page?.content;
    if (!scale || !c) return;
    const side = TILE / scale;
    for (let iy = Math.floor(c.y / side); iy * side < c.y + c.h; iy++) {
      for (let ix = Math.floor(c.x / side); ix * side < c.x + c.w; ix++) {
        request({ scale, ix, iy }, priority, true);
      }
    }
  };

  /** Cancels queued renders the current view no longer needs. */
  const prune = (wanted: Set<string>) => {
    const cancel: number[] = [];
    for (const [id, e] of cache) {
      if (e.pending && !e.pinned && !wanted.has(id)) {
        cancel.push(e.pending.id);
        e.pending = undefined;
        // A stale tile out of view is dropped rather than kept wrong.
        if (!e.bitmap || e.stale) {
          e.bitmap?.close();
          cache.delete(id);
        }
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

  /**
   * After an edit: the view's tiles at once, the margin's and the
   * overview's once edits pause (behind the view's).
   */
  const afterEdit = () => {
    if (lastView) schedule(lastView, false);
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      if (disposed) return;
      requestOverview(AFTER_VIEW);
      if (lastView) schedule(lastView, true);
    }, EDIT_SETTLE_MS);
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

    /**
     * Marks tiles touching a page rectangle as changed: visible ones are
     * re-rendered (the old pixels stay up meanwhile), others dropped.
     */
    invalidate(rect: Rect) {
      const cancel: number[] = [];
      for (const [id, e] of cache) {
        if (!tileTouches(e.key, rect)) continue;
        if (e.pending) {
          cancel.push(e.pending.id);
          e.pending = undefined;
        }
        if (e.bitmap) e.stale = true;
        else cache.delete(id);
      }
      engine.cancel(cancel);
      if (page && page.content) {
        // Edits can grow the page's content beyond its old bounds.
        page = { ...page, content: unionContent(page.content, rect) };
      }
      afterEdit();
    },

    /** New content bounds for the same page (after edits). */
    setContent(content: Rect | undefined) {
      if (page) page = { ...page, content };
      afterEdit();
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
      // Tiles are opaque: picked sharpest first, a tile goes unpainted where
      // the tiles of a sharper scale cover all of it that shows (most of the
      // view, once the exact tiles are in), so coarse stand-ins are drawn
      // only in the gaps.
      const present = new Map<number, Set<string>>();
      for (const e of cache.values()) {
        if (!e.bitmap) continue;
        const set = present.get(e.key.scale) ?? new Set<string>();
        present.set(e.key.scale, set);
        set.add(`${e.key.ix}:${e.key.iy}`);
      }
      const sharper: number[] = [];
      const draws: {
        bitmap: ImageBitmap;
        exact: boolean;
        x: number;
        y: number;
        size: number;
      }[] = [];
      for (let k = ordered.length - 1; k >= 0; k--) {
        const scale = ordered[k];
        const exact = scale === target;
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
          const shown = {
            x: Math.max(r.x, camera.x),
            y: Math.max(r.y, camera.y),
            w: Math.min(r.x + r.w, camera.x + viewW) - Math.max(r.x, camera.x),
            h: Math.min(r.y + r.h, camera.y + viewH) - Math.max(r.y, camera.y),
          };
          const hidden = sharper.some((s) =>
            tilesCover(shown, s, present.get(s) ?? new Set(), page?.content)
          );
          if (!hidden) draws.push({ bitmap: e.bitmap, exact, x, y, size });
        }
        sharper.push(scale);
      }
      for (let k = draws.length - 1; k >= 0; k--) {
        const d = draws[k];
        ctx.imageSmoothingEnabled = !d.exact;
        // Enlarged stand-ins are blurry either way; bilinear filtering
        // costs a fraction of bicubic. Reductions keep mipmapped filtering.
        ctx.imageSmoothingQuality = d.size > TILE ? 'low' : 'high';
        ctx.drawImage(d.bitmap, d.x, d.y, d.size, d.size);
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
      clearTimeout(editTimer);
      for (const e of cache.values()) {
        e.bitmap?.close();
        if (e.pending) engine.cancel([e.pending.id]);
      }
      cache.clear();
    },
  };
}

function unionContent(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export type TileCompositor = ReturnType<typeof createTileCompositor>;
