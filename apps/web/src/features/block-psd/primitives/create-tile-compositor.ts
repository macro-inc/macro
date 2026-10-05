/**
 * Tiled rendering of the canvas.
 *
 * The engine composites the document at mip levels in tiles (see
 * `core/tiles.ts`); this keeps a cache of them and draws whatever is
 * available, over a checkerboard where the document is transparent.
 * Drawing never waits for compositing: an overview of the whole canvas is
 * pinned and coarse tiles stand in, scaled, until sharp ones arrive.
 *
 * - The view asks for tiles at the level whose pixels are just finer than
 *   the screen's (level 0 when magnified, drawn with hard pixel edges).
 * - Each screen cell is drawn from exactly one source (the tile, its four
 *   sharper children, or a coarser ancestor), since tiles are transparent.
 * - After an edit, only the changed rectangle of the tiles in view is
 *   composited again and patched into them, so a brush stroke redraws a
 *   few pixels per frame; tiles out of view, at other levels, and the
 *   overview are re-rendered once edits pause (they stay up meanwhile).
 * - Requests that fall out of view before they start are cancelled.
 */

import type { PendingTile, PsdEngine, TileResult } from '@core/psd-engine/client';
import type { IRect } from '@core/psd-engine/types';
import type { Camera, Size } from '@app/features/block-fig/core/camera';
import {
  canvasToLevel,
  cellSources,
  type DocSize,
  intersect,
  isEmpty,
  levelFor,
  overviewLevel,
  sourceRegion,
  type TileKey,
  tileId,
  tileLevelRect,
  tilesFor,
  tileTouches,
} from '../core/tiles';

/** A drawing surface a tile's pixels are kept on (a canvas). */
export interface TileSurface {
  width: number;
  height: number;
  getContext(kind: '2d'): Pick<
    CanvasRenderingContext2D,
    'clearRect' | 'drawImage'
  > | null;
}

interface Entry {
  key: TileKey;
  /** The level pixels it covers (within the canvas). */
  rect: IRect;
  surface?: TileSurface;
  /** A full render in flight. */
  pending?: PendingTile;
  /** Changed-area renders in flight. */
  patches: number;
  /** The pixels predate an edit: shown until replaced. */
  stale: boolean;
  lastUsed: number;
  pinned: boolean;
}

export interface CompositorView {
  camera: Camera;
  /** Canvas element size in CSS pixels. */
  viewport: Size;
  dpr: number;
}

export interface TileCompositorOptions {
  engine: Pick<PsdEngine, 'render' | 'cancel'>;
  /** Called when pixels arrive (the canvas should redraw). */
  onTile: () => void;
  /** A surface for a tile's pixels (a canvas element by default). */
  createSurface?: (width: number, height: number) => TileSurface;
  /** Tiles kept besides the overview (each up to TILE² × 4 bytes). */
  budget?: number;
}

/** Longest side of the overview, in pixels. */
const OVERVIEW_SIDE = 2048;
/** Quiet time after which the view counts as settled (prefetch a margin). */
const SETTLE_MS = 140;
/** Quiet time after an edit before tiles out of view are re-rendered. */
const EDIT_SETTLE_MS = 300;
/** Priority of changed-area renders: before anything else. */
const PATCH_PRIORITY = -2;
/** Priority of the overview when opening: before the view. */
const OVERVIEW_PRIORITY = -1;
/** Priority of stale overview tiles after edits: after the view's. */
const AFTER_VIEW = Number.MAX_SAFE_INTEGER;

const defaultSurface = (width: number, height: number): TileSurface => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** The canvas area a view shows (in canvas pixels), within the document. */
export function viewRect(view: CompositorView, doc: DocSize): IRect {
  const { camera, viewport } = view;
  return intersect(
    {
      x: Math.floor(camera.x),
      y: Math.floor(camera.y),
      w: Math.ceil(viewport.w / camera.zoom) + 2,
      h: Math.ceil(viewport.h / camera.zoom) + 2,
    },
    { x: 0, y: 0, w: doc.width, h: doc.height }
  );
}

export function createTileCompositor(options: TileCompositorOptions) {
  const { engine } = options;
  const budget = options.budget ?? 120;
  const createSurface = options.createSurface ?? defaultSurface;
  const cache = new Map<string, Entry>();
  let doc: DocSize | undefined;
  let generation = 0;
  let clock = 0;
  let lastView: CompositorView | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let editTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** Render timings, for diagnostics and tests. */
  const stats = { rendered: 0, patched: 0, millis: 0 };

  const evict = () => {
    const live = [...cache.values()].filter(
      (e) => !e.pinned && e.surface && !e.pending && e.patches === 0
    );
    if (live.length <= budget) return;
    live.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of live.slice(0, live.length - budget))
      cache.delete(tileId(e.key));
  };

  const ensureSurface = (entry: Entry) => {
    if (
      !entry.surface ||
      entry.surface.width !== entry.rect.w ||
      entry.surface.height !== entry.rect.h
    )
      entry.surface = createSurface(entry.rect.w, entry.rect.h);
    return entry.surface;
  };

  /** Composites a whole tile. */
  const render = (entry: Entry, priority: number) => {
    const pending = engine.render({
      x: entry.rect.x,
      y: entry.rect.y,
      level: entry.key.level,
      width: entry.rect.w,
      height: entry.rect.h,
      priority,
    });
    entry.pending = pending;
    const forGeneration = generation;
    const id = tileId(entry.key);
    const settle = async () => {
      let result: TileResult | null = null;
      try {
        result = await pending.promise;
      } catch {
        result = null;
      }
      const current = entry.pending?.id === pending.id;
      if (current) entry.pending = undefined;
      if (
        !result ||
        disposed ||
        !current ||
        forGeneration !== generation ||
        cache.get(id) !== entry
      ) {
        result?.bitmap?.close();
        if (current && !entry.surface && cache.get(id) === entry) cache.delete(id);
        return;
      }
      const ctx = ensureSurface(entry).getContext('2d');
      ctx?.clearRect(0, 0, entry.rect.w, entry.rect.h);
      if (result.bitmap) {
        ctx?.drawImage(result.bitmap, 0, 0);
        result.bitmap.close();
      }
      entry.stale = false;
      stats.rendered++;
      stats.millis += result.millis;
      evict();
      options.onTile();
    };
    void settle();
  };

  /** Composites the changed part of a tile and patches it in. */
  const patch = (entry: Entry, area: IRect) => {
    const pending = engine.render({
      x: area.x,
      y: area.y,
      level: entry.key.level,
      width: area.w,
      height: area.h,
      priority: PATCH_PRIORITY,
    });
    entry.patches++;
    const forGeneration = generation;
    const id = tileId(entry.key);
    const settle = async () => {
      let result: TileResult | null = null;
      try {
        result = await pending.promise;
      } catch {
        result = null;
      }
      entry.patches--;
      if (
        !result ||
        disposed ||
        forGeneration !== generation ||
        cache.get(id) !== entry ||
        !entry.surface
      ) {
        result?.bitmap?.close();
        return;
      }
      const x = area.x - entry.rect.x;
      const y = area.y - entry.rect.y;
      const ctx = entry.surface.getContext('2d');
      ctx?.clearRect(x, y, area.w, area.h);
      if (result.bitmap) {
        ctx?.drawImage(result.bitmap, x, y);
        result.bitmap.close();
      }
      stats.patched++;
      stats.millis += result.millis;
      options.onTile();
    };
    void settle();
  };

  const request = (key: TileKey, priority: number, pinned = false) => {
    if (!doc) return;
    const id = tileId(key);
    const existing = cache.get(id);
    if (existing) {
      existing.lastUsed = ++clock;
      existing.pinned ||= pinned;
      if ((existing.stale || !existing.surface) && !existing.pending)
        render(existing, priority);
      return;
    }
    const rect = tileLevelRect(key, doc);
    if (isEmpty(rect)) return;
    const entry: Entry = {
      key,
      rect,
      patches: 0,
      stale: false,
      lastUsed: ++clock,
      pinned,
    };
    cache.set(id, entry);
    render(entry, priority);
  };

  const requestOverview = (priority: number) => {
    if (!doc) return;
    const level = overviewLevel(doc, OVERVIEW_SIDE);
    for (const key of tilesFor(
      { x: 0, y: 0, w: doc.width, h: doc.height },
      level,
      doc
    ))
      request(key, priority, true);
  };

  /** Cancels queued renders the view no longer needs. */
  const prune = (wanted: Set<string>) => {
    const cancel: number[] = [];
    for (const [id, e] of cache) {
      if (!e.pending || e.pinned || wanted.has(id)) continue;
      cancel.push(e.pending.id);
      e.pending = undefined;
      if (!e.surface) cache.delete(id);
    }
    engine.cancel(cancel);
  };

  const wantedFor = (view: CompositorView, margin: number) => {
    if (!doc) return [];
    const level = levelFor(view.camera.zoom * view.dpr);
    return tilesFor(viewRect(view, doc), level, doc, margin);
  };

  const schedule = (view: CompositorView, settled: boolean) => {
    if (!doc) return;
    const wanted = new Set<string>();
    let priority = 0;
    for (const key of wantedFor(view, settled ? 1 : 0)) {
      wanted.add(tileId(key));
      request(key, priority++);
    }
    prune(wanted);
  };

  /** After edits pause: the overview's and the margin's tiles. */
  const afterEdit = () => {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      if (disposed) return;
      requestOverview(AFTER_VIEW);
      if (lastView) schedule(lastView, true);
    }, EDIT_SETTLE_MS);
  };

  return {
    stats,

    /** Starts over for a document (on opening, or when its size changed). */
    setDocument(next: DocSize) {
      for (const e of cache.values())
        if (e.pending) engine.cancel([e.pending.id]);
      cache.clear();
      generation++;
      doc = { width: next.width, height: next.height };
      requestOverview(OVERVIEW_PRIORITY);
      if (lastView) schedule(lastView, true);
    },

    /**
     * Marks a canvas rectangle changed: the tiles in view are patched (the
     * old pixels stay up meanwhile), the others re-rendered later.
     */
    invalidate(rect: IRect) {
      if (!doc || isEmpty(rect)) return;
      const inView = new Set(
        lastView ? wantedFor(lastView, 0).map(tileId) : []
      );
      const cancel: number[] = [];
      for (const [id, e] of cache) {
        if (!tileTouches(e.key, rect)) continue;
        if (e.pending) {
          cancel.push(e.pending.id);
          e.pending = undefined;
          if (!e.surface) {
            cache.delete(id);
            continue;
          }
          e.stale = true;
          continue;
        }
        if (!e.surface) continue;
        const area = intersect(canvasToLevel(rect, e.key.level), e.rect);
        if (isEmpty(area)) continue;
        if (inView.has(id) && !e.stale) patch(e, area);
        else e.stale = true;
      }
      engine.cancel(cancel);
      if (lastView) schedule(lastView, false);
      afterEdit();
    },

    /** Call on every view change; fetches what the view needs. */
    update(view: CompositorView) {
      lastView = view;
      schedule(view, false);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (lastView && !disposed) schedule(lastView, true);
      }, SETTLE_MS);
    },

    /**
     * Draws the document from the tiles available now, over `checker`
     * where it is transparent; clears what is outside the document.
     */
    draw(
      ctx: CanvasRenderingContext2D,
      view: CompositorView,
      checker?: CanvasPattern | string
    ) {
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      ctx.clearRect(0, 0, width, height);
      if (!doc) return;
      const { camera } = view;
      const s = camera.zoom * view.dpr;
      const sx = (x: number) => Math.round((x - camera.x) * s);
      const sy = (y: number) => Math.round((y - camera.y) * s);
      const x0 = sx(0);
      const y0 = sy(0);
      const x1 = sx(doc.width);
      const y1 = sy(doc.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      if (checker) {
        ctx.fillStyle = checker;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      const has = (k: TileKey) => !!cache.get(tileId(k))?.surface;
      const current = doc;
      for (const cell of wantedFor(view, 0)) {
        for (const source of cellSources(cell, current, has)) {
          const entry = cache.get(tileId(source));
          const region = sourceRegion(source, cell, current);
          if (!entry?.surface || !region) continue;
          entry.lastUsed = ++clock;
          const dx = sx(region.to.x);
          const dy = sy(region.to.y);
          const dw = sx(region.to.x + region.to.w) - dx;
          const dh = sy(region.to.y + region.to.h) - dy;
          if (dw <= 0 || dh <= 0) continue;
          // Magnified pixels keep hard edges, as in Photoshop.
          const magnified = s * 2 ** source.level > 1.001;
          ctx.imageSmoothingEnabled = !magnified;
          if (!magnified) ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(
            entry.surface as CanvasImageSource,
            region.from.x,
            region.from.y,
            region.from.w,
            region.from.h,
            dx,
            dy,
            dw,
            dh
          );
        }
      }
      ctx.restore();
    },

    /** Whether every tile the view needs is drawn sharp and current. */
    isSharp(view: CompositorView): boolean {
      return wantedFor(view, 0).every((key) => {
        const e = cache.get(tileId(key));
        return !!e?.surface && !e.stale && !e.pending && e.patches === 0;
      });
    },

    /** Whether no render is in flight. */
    idle(): boolean {
      for (const e of cache.values()) if (e.pending || e.patches > 0) return false;
      return true;
    },

    dispose() {
      disposed = true;
      clearTimeout(settleTimer);
      clearTimeout(editTimer);
      for (const e of cache.values())
        if (e.pending) engine.cancel([e.pending.id]);
      cache.clear();
    },
  };
}

export type TileCompositor = ReturnType<typeof createTileCompositor>;
