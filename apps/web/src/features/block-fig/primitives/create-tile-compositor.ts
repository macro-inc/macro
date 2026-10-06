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
 * - Layers being moved are lifted (`core/lift`): what paints below them,
 *   the layers, and what paints above them render once, in tiles, and each
 *   frame composites them with the layers shifted, so a move drag renders
 *   nothing per step. After the drop the lift stays up until the page's
 *   tiles have caught up with the move.
 */

import type {
  FigEngine,
  PendingTile,
  TileResult,
} from '@core/fig-engine/client';
import type { LiftPlan, Rect } from '@core/fig-engine/types';
import type { Camera, Point, Size } from '../core/camera';
import {
  liftParts,
  liftTiles,
  offsetRect,
  type Patch,
  runTiles,
  tilePatch,
} from '../core/lift';
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
  /** For a lift's part: the part of the tile it renders (else all). */
  patch?: Patch;
  /** The edits (see `edits`) its bitmap shows. */
  version?: number;
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
/** A quick first image, before rendering the visible area at full detail. */
const FIRST_OVERVIEW_SIDE = 512;
/** Quiet time after which the view counts as settled. */
const SETTLE_MS = 100;
/** Quiet time after an edit before tiles out of view are re-rendered. */
const EDIT_SETTLE_MS = 300;
/** Priority of overview tiles changed by an edit: after every view tile. */
const AFTER_VIEW = Number.MAX_SAFE_INTEGER;
/**
 * Priorities of a lift's tiles, ahead of the view's: the moving layers
 * first, then what goes where they started, then the rest.
 */
const LIFT_RUN = -3_000_000;
const LIFT_HOME = -2_000_000;
const LIFT_OTHER = -1_000_000;
/** Longest a landed lift waits for the page's tiles before dropping. */
const LAND_TIMEOUT_MS = 2000;

/** A part of a lift (see `core/lift`): its renders and their tiles. */
interface LiftPart {
  /** `LayersSpec` JSON. */
  layers: string;
  tiles: Map<string, Entry>;
}

interface Lift {
  plan: LiftPlan;
  /** Page tiles rendered while it is dragged leave the layers out. */
  page: string;
  /** Scale (device pixels per page unit) of every part's tiles. */
  scale: number;
  below: LiftPart;
  runs: { part: LiftPart; clips: Path2D[] }[];
  above: LiftPart[];
  /** Page-space offset of the moving layers. */
  offset: Point;
  /** Rendering ahead of a drag that has not started: not drawn yet. */
  hidden: boolean;
  /** Dropped: the parts stay as they are until the lift comes down. */
  frozen: boolean;
  /** The move reached the document (the area it changed). */
  landing?: { dirty: Rect; since: number };
}

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
  /** Edits seen (invalidations), to order renders of one tile. */
  let edits = 0;
  /** The layers being dragged (or about to be). */
  let lift: Lift | undefined;
  /** Dropped lifts, oldest first, drawn until the page shows their moves. */
  const landing: Lift[] = [];
  let landTimer: ReturnType<typeof setTimeout> | undefined;
  /** Render timings, for diagnostics. */
  const stats = { rendered: 0, millis: 0 };
  // Effects that cross layer boundaries cannot use a lifted sprite. During
  // those gestures, replace complete viewport frames instead of mixing tiles
  // from different edit positions. Keep only one render in flight.
  let interactive = false;
  let preview: { bitmap: ImageBitmap; view: ViewState } | undefined;
  let previewPending: PendingTile | undefined;
  let previewDirty = false;
  let previewGeneration = 0;
  let previewPixels = 512;

  const clearPreview = () => {
    previewGeneration++;
    preview?.bitmap.close();
    preview = undefined;
    if (previewPending) engine.cancel([previewPending.id]);
    previewPending = undefined;
    previewDirty = false;
  };

  const renderPreview = async () => {
    if (previewPending || !previewDirty || !lastView || !page) return;
    const view = lastView;
    const { w, h } = view.viewport;
    if (w <= 0 || h <= 0) return;
    previewDirty = false;
    const epoch = previewGeneration;
    const ratio = Math.min(view.dpr, previewPixels / Math.max(w, h));
    const job = engine.render({
      page: page.page,
      x: view.camera.x,
      y: view.camera.y,
      scale: view.camera.zoom * ratio,
      width: Math.max(1, Math.ceil(w * ratio)),
      height: Math.max(1, Math.ceil(h * ratio)),
      outline: page.outline,
      priority: -4_000_000,
    });
    previewPending = job;
    try {
      const result = await job.promise;
      if (!result) return;
      if (disposed || epoch !== previewGeneration) {
        result.bitmap.close();
        return;
      }
      preview?.bitmap.close();
      preview = { bitmap: result.bitmap, view };
      // Keep expensive blur/shadow scenes near a 20ms raster budget while
      // moving. Full-resolution tiles replace this preview after release.
      const adjustment = Math.max(
        0.75,
        Math.min(1.25, Math.sqrt(20 / Math.max(1, result.millis)))
      );
      previewPixels = Math.max(384, Math.min(768, previewPixels * adjustment));
      options.onTile();
    } finally {
      if (previewPending?.id === job.id) {
        previewPending = undefined;
        if (previewDirty) void requestPreview();
      }
    }
  };

  const requestPreview = async () => {
    try {
      await renderPreview();
    } catch {
      /* Keep the last complete frame. */
    }
  };

  const sharp = (view: ViewState) => {
    const target = quantizeScale(view.camera.zoom * view.dpr);
    return tilesFor(view.camera, view.viewport, target, 0).every((key) => {
      if (page?.content && !tileTouches(key, page.content)) return true;
      const entry = cache.get(tileId(key));
      return !!entry?.bitmap && !entry.stale && !entry.pending;
    });
  };

  const evict = () => {
    const live = [...cache.values()].filter((e) => !e.pinned && e.bitmap);
    if (live.length <= budget) return;
    live.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of live.slice(0, live.length - budget)) {
      e.bitmap?.close();
      cache.delete(tileId(e.key));
    }
  };

  /**
   * What page tiles leave out: the layers of the lift being dragged, which
   * the document may move before the drop (it shares the drag with other
   * people as it goes) while the lift draws them.
   */
  const pageLayers = () =>
    lift && !lift.hidden && !lift.frozen ? lift.page : undefined;

  /** Renders a tile of the page, or of a lift's part into its tiles. */
  const render = (entry: Entry, priority: number, part?: LiftPart) => {
    if (!page) return;
    const home = part?.tiles ?? cache;
    const { key } = entry;
    const patch = entry.patch ?? { x: 0, y: 0, w: TILE, h: TILE };
    const pending = engine.render({
      page: page.page,
      x: (key.ix * TILE + patch.x) / key.scale,
      y: (key.iy * TILE + patch.y) / key.scale,
      scale: key.scale,
      width: patch.w,
      height: patch.h,
      outline: page.outline,
      priority,
      layers: part?.layers ?? pageLayers(),
    });
    entry.pending = pending;
    const id = tileId(entry.key);
    const forGeneration = generation;
    const version = edits;
    /** A render that brought nothing: the entry goes if it holds nothing. */
    const settleEmpty = () => {
      if (entry.pending?.id === pending.id) entry.pending = undefined;
      if (!entry.bitmap && !entry.pending && home.get(id) === entry)
        home.delete(id);
    };
    pending.promise
      .then((result: TileResult | null) => {
        // Cancelled, or (when not current) superseded by an edit.
        const current = entry.pending?.id === pending.id;
        if (!result) {
          settleEmpty();
          return;
        }
        if (
          disposed ||
          forGeneration !== generation ||
          home.get(id) !== entry ||
          version < (entry.version ?? -1)
        ) {
          result.bitmap.close();
          return;
        }
        // A render an edit superseded mid-way is still newer than what
        // shows: it shows until the current one lands, so a stream of
        // edits (a drag the canvas cannot lift) updates as fast as tiles
        // render instead of waiting for the edits to pause.
        entry.bitmap?.close();
        entry.bitmap = result.bitmap;
        entry.version = version;
        if (current) {
          entry.pending = undefined;
          entry.stale = false;
          stats.rendered++;
          stats.millis += result.millis;
        }
        if (!part) evict();
        options.onTile();
      })
      .catch(settleEmpty);
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

  const overviewScale = (side: number) => {
    const c = page?.content;
    if (!c || !(c.w > 0 && c.h > 0)) return undefined;
    return quantizeScale(Math.min(side / Math.max(c.w, c.h), 64));
  };

  /** The overview's tiles, first of all unless `priority` says otherwise. */
  const requestOverview = (priority = -1, pixels = OVERVIEW_SIDE) => {
    const scale = overviewScale(pixels);
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
    if (interactive) {
      previewDirty = true;
      void requestPreview();
      return;
    }
    if (lastView) schedule(lastView, false);
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      if (disposed) return;
      requestOverview(AFTER_VIEW);
      if (lastView) schedule(lastView, true);
    }, EDIT_SETTLE_MS);
  };

  // ---- lifting --------------------------------------------------------

  /** Requests a tile of a lift's part unless it has a current one. */
  const requestPart = (
    part: LiftPart,
    key: TileKey,
    priority: number,
    patch: Patch | undefined
  ) => {
    if (!patch) return;
    const id = tileId(key);
    const existing = part.tiles.get(id);
    if (existing) {
      if (existing.stale && !existing.pending) render(existing, priority, part);
      return;
    }
    const entry: Entry = { key, lastUsed: ++clock, pinned: false, patch };
    part.tiles.set(id, entry);
    render(entry, priority, part);
  };

  /** Requests what the lift needs to draw the view at its offset. */
  const requestLift = () => {
    const view = lastView;
    if (!lift || lift.frozen || !view) return;
    const { camera, viewport } = view;
    const { plan, scale, offset, below, runs, above } = lift;
    // The below part differs from the page where the runs started and
    // under what paints above them.
    const homes = plan.runs.map((r) => r.bounds);
    const changed = [...homes, ...plan.runs.flatMap((r) => r.above)];
    let n = 0;
    plan.runs.forEach((run, k) => {
      for (const key of runTiles(run.bounds, offset, camera, viewport, scale))
        requestPart(
          runs[k].part,
          key,
          LIFT_RUN + n++,
          tilePatch(key, [run.bounds])
        );
    });
    for (const t of liftTiles(plan, offset, camera, viewport, scale)) {
      const home = homes.some((b) => tileTouches(t.key, b));
      const priority = (home ? LIFT_HOME : LIFT_OTHER) + n++;
      if (t.below)
        requestPart(below, t.key, priority, tilePatch(t.key, changed));
      for (const k of t.above)
        requestPart(
          above[k],
          t.key,
          priority,
          tilePatch(t.key, plan.runs[k].above)
        );
    }
  };

  const partsOf = (l: Lift) => [
    l.below,
    ...l.runs.map((r) => r.part),
    ...l.above,
  ];

  /** Frees a lift's tiles. */
  const discard = (l: Lift) => {
    const cancel: number[] = [];
    for (const part of partsOf(l)) {
      for (const e of part.tiles.values()) {
        e.bitmap?.close();
        if (e.pending) cancel.push(e.pending.id);
      }
      part.tiles.clear();
    }
    engine.cancel(cancel);
  };

  /** Takes down the lift being dragged (dropped ones land on their own). */
  const unlift = () => {
    if (lift) discard(lift);
    lift = undefined;
  };

  /**
   * A lift starts being drawn: page renders queued before it would draw the
   * layers wherever the document has them when they run, so they are
   * queued again, leaving the layers out (`pageLayers`).
   */
  const holdPage = () => {
    const cancel: number[] = [];
    for (const [id, e] of cache) {
      if (!e.pending) continue;
      cancel.push(e.pending.id);
      e.pending = undefined;
      if (!e.bitmap) cache.delete(id);
    }
    engine.cancel(cancel);
    if (lastView) schedule(lastView, false);
  };

  /**
   * Whether the page's tiles in view show a dropped lift's move: those it
   * changed are rendered again (or the wait ran out).
   */
  const landed = (l: Lift, view: ViewState): boolean => {
    const done = l.landing;
    if (!done) return false;
    if (performance.now() - done.since > LAND_TIMEOUT_MS) return true;
    const target = quantizeScale(view.camera.zoom * view.dpr);
    return tilesFor(view.camera, view.viewport, target, 0).every((key) => {
      if (!tileTouches(key, done.dirty)) return true;
      if (page?.content && !tileTouches(key, page.content)) return true;
      const e = cache.get(tileId(key));
      return !!e?.bitmap && !e.stale && !e.pending;
    });
  };

  /** Draws a lift over the page's tiles (see `core/lift`). */
  const drawLift = (
    ctx: CanvasRenderingContext2D,
    view: ViewState,
    l: Lift
  ) => {
    if (l.hidden) return;
    const { camera, dpr } = view;
    const { plan, scale, offset } = l;
    const unit = camera.zoom * dpr;
    // At the view's own scale, tiles land on whole device pixels.
    const exact = scale === quantizeScale(unit);
    const k = exact ? scale : unit;
    const ox = exact ? Math.round(camera.x * scale) : camera.x * unit;
    const oy = exact ? Math.round(camera.y * scale) : camera.y * unit;
    // Device pixels of a tile's own pixel at the view's scale.
    const px = exact ? 1 : unit / scale;
    const blit = (e: Entry | undefined, dx = 0, dy = 0) => {
      if (!e?.bitmap) return;
      const patch = e.patch ?? { x: 0, y: 0, w: TILE, h: TILE };
      const x = e.key.ix * TILE * px - ox + patch.x * px + dx;
      const y = e.key.iy * TILE * px - oy + patch.y * px + dy;
      ctx.drawImage(e.bitmap, x, y, patch.w * px, patch.h * px);
    };
    const tile = (part: LiftPart, key: TileKey) => part.tiles.get(tileId(key));
    ctx.imageSmoothingEnabled = !exact;
    ctx.imageSmoothingQuality = 'low';
    // A tile is drawn from the parts once every part it needs is in; until
    // then the page's tile stays, with the layers drawn over it.
    const tiles = liftTiles(plan, offset, camera, view.viewport, scale).filter(
      (t) =>
        (!t.below || !!tile(l.below, t.key)?.bitmap) &&
        t.above.every((a) => !!tile(l.above[a], t.key)?.bitmap)
    );
    for (const t of tiles) if (t.below) blit(tile(l.below, t.key));
    const dx = exact ? Math.round(offset.x * scale) : offset.x * unit;
    const dy = exact ? Math.round(offset.y * scale) : offset.y * unit;
    l.runs.forEach((run, index) => {
      ctx.save();
      if (run.clips.length > 0) {
        // The clipping ancestors stay where they are.
        ctx.setTransform(k, 0, 0, k, -ox, -oy);
        for (const clip of run.clips) ctx.clip(clip);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      for (const e of run.part.tiles.values()) blit(e, dx, dy);
      ctx.restore();
      for (const t of tiles) {
        if (t.above.includes(index)) blit(tile(l.above[index], t.key));
      }
    });
  };

  /**
   * Marks tiles touching a page rectangle as changed: visible ones are
   * re-rendered (the old pixels stay up meanwhile), others dropped.
   */
  const invalidate = (rect: Rect) => {
    edits++;
    const cancel: number[] = [];
    for (const [id, e] of cache) {
      if (!tileTouches(e.key, rect)) continue;
      if (!e.bitmap && !e.pending) {
        cache.delete(id);
        continue;
      }
      // Renders already under way still land (see `render`); the rest
      // are dropped, and the tile renders again.
      if (e.pending) {
        cancel.push(e.pending.id);
        e.pending = undefined;
      }
      e.stale = true;
    }
    engine.cancel(cancel);
    if (page && page.content) {
      // Edits can grow the page's content beyond its old bounds.
      page = { ...page, content: unionContent(page.content, rect) };
    }
    // Other people's edits during a drag reach the lift's parts (its runs
    // render anchored where the lift started, the rest leaves them out). A
    // dropped lift keeps its parts: the move itself is what changed.
    if (lift && !lift.frozen) {
      const cancelParts: number[] = [];
      for (const part of partsOf(lift)) {
        for (const [id, e] of part.tiles) {
          if (!tileTouches(e.key, rect)) continue;
          // As for the page's tiles: a render under way still lands, but
          // the part renders again.
          if (e.pending) {
            cancelParts.push(e.pending.id);
            e.pending = undefined;
          }
          if (e.bitmap) e.stale = true;
          else part.tiles.delete(id);
        }
      }
      engine.cancel(cancelParts);
      requestLift();
    }
    afterEdit();
  };

  return {
    stats,

    /** Whole-frame fallback for moves whose effects cannot be lifted. */
    beginInteractive() {
      interactive = true;
      clearTimeout(settleTimer);
      clearTimeout(editTimer);
      const cancelled: number[] = [];
      for (const [id, entry] of cache) {
        if (entry.pending) cancelled.push(entry.pending.id);
        entry.pending = undefined;
        if (!entry.bitmap) cache.delete(id);
      }
      engine.cancel(cancelled);
      previewDirty = true;
      void requestPreview();
    },

    endInteractive() {
      interactive = false;
      // The complete preview stays visible until every final visible tile
      // is ready; never reveal a checkerboard of old and new positions.
      afterEdit();
      options.onTile();
    },

    /** Starts over for a page (or after switching outline view). */
    setPage(next: PageState) {
      interactive = false;
      clearPreview();
      unlift();
      for (const l of landing.splice(0)) discard(l);
      for (const e of cache.values()) {
        e.bitmap?.close();
        if (e.pending) engine.cancel([e.pending.id]);
      }
      cache.clear();
      generation++;
      page = next;
      requestOverview(-1, FIRST_OVERVIEW_SIDE);
      if (lastView) schedule(lastView, true);
    },

    invalidate,

    /** New content bounds for the same page (after edits). */
    setContent(content: Rect | undefined) {
      if (page) page = { ...page, content };
      afterEdit();
    },

    /** Call on every view change; fetches what the view needs. */
    update(view: ViewState) {
      lastView = view;
      if (interactive) {
        previewDirty = true;
        void requestPreview();
        return;
      }
      requestLift();
      schedule(view, false);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (lastView && !disposed) {
          schedule(lastView, true);
          requestOverview(AFTER_VIEW);
        }
      }, SETTLE_MS);
    },

    /** Draws available tiles; returns whether content (or an empty page) is ready. */
    draw(ctx: CanvasRenderingContext2D, view: ViewState) {
      if (!interactive && (preview || previewPending) && sharp(view))
        clearPreview();
      if (preview) {
        const { camera, viewport, dpr } = view;
        const old = preview.view;
        const scale = (camera.zoom / old.camera.zoom) * dpr;
        ctx.fillStyle = page?.background ?? '#f5f5f5';
        ctx.fillRect(0, 0, viewport.w * dpr, viewport.h * dpr);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'low';
        ctx.drawImage(
          preview.bitmap,
          (old.camera.x - camera.x) * camera.zoom * dpr,
          (old.camera.y - camera.y) * camera.zoom * dpr,
          old.viewport.w * scale,
          old.viewport.h * scale
        );
        return true;
      }
      // In order: a newer drop may sit on top of an older one's parts.
      while (landing.length > 0 && landed(landing[0], view)) {
        const done = landing.shift();
        if (done) discard(done);
      }
      const { camera, dpr } = view;
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      ctx.fillStyle = page?.background ?? '#f5f5f5';
      ctx.fillRect(0, 0, width, height);
      if (!page) return false;
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
      for (const l of landing) drawLift(ctx, view, l);
      if (lift) drawLift(ctx, view, lift);
      return (
        draws.length > 0 ||
        !page.content ||
        page.content.w <= 0 ||
        page.content.h <= 0
      );
    },

    /**
     * Lifts layers to move them (see `core/lift`) at the view's scale;
     * `hidden` renders the parts ahead of a drag without drawing them yet.
     * Returns whether the lift is up (its clips must parse).
     */
    lift(plan: LiftPlan, hidden = false): boolean {
      unlift();
      const view = lastView;
      if (!page || !view || plan.refused || plan.runs.length === 0)
        return false;
      let clips: Path2D[][];
      try {
        clips = plan.runs.map((r) => r.clips.map((d) => new Path2D(d)));
      } catch {
        return false;
      }
      const parts = liftParts(plan);
      const part = (layers: unknown): LiftPart => ({
        layers: JSON.stringify(layers),
        tiles: new Map(),
      });
      lift = {
        plan,
        page: JSON.stringify(parts.page),
        scale: quantizeScale(view.camera.zoom * view.dpr),
        below: part(parts.below),
        runs: parts.runs.map((r, k) => ({ part: part(r), clips: clips[k] })),
        above: parts.above.map(part),
        offset: { x: 0, y: 0 },
        hidden,
        frozen: false,
      };
      requestLift();
      if (!hidden) holdPage();
      return true;
    },

    /** Draws a hidden lift from now on; whether there was one. */
    showLift(): boolean {
      if (!lift) return false;
      if (lift.hidden) {
        lift.hidden = false;
        holdPage();
      }
      return true;
    },

    /** Moves the lifted layers to a page-space offset from where they were. */
    moveLift(offset: Point) {
      if (!lift || lift.frozen) return;
      lift.offset = offset;
      requestLift();
    },

    /** The drop: the lift's parts stay as they are from now on. */
    freezeLift() {
      if (lift) lift.frozen = true;
    },

    /**
     * The drop reached the document, which moved the layers by `moved`
     * (`null`: not at all). Page tiles drawn meanwhile left the layers out,
     * so the page renders again where they were and where they are, and
     * the lift comes down once it shows them.
     */
    landLift(moved: Point | null) {
      const dropped = lift;
      lift = undefined;
      if (!dropped) return;
      if (dropped.hidden) {
        // Never drawn, so the page tiles are as they were.
        discard(dropped);
        return;
      }
      dropped.frozen = true;
      const home = dropped.plan.runs
        .map((r) => r.bounds)
        .reduce((a, b) => unionContent(a, b));
      const there =
        moved && (moved.x !== 0 || moved.y !== 0)
          ? offsetRect(home, moved)
          : undefined;
      dropped.landing = {
        dirty: there ? unionContent(home, there) : home,
        since: performance.now(),
      };
      landing.push(dropped);
      invalidate(home);
      if (there) invalidate(there);
      clearTimeout(landTimer);
      landTimer = setTimeout(() => {
        if (!disposed) options.onTile();
      }, LAND_TIMEOUT_MS + 50);
    },

    /** Takes down the lift being dragged. */
    unlift,

    /** Whether the lift being dragged (or prepared) is `plan`'s. */
    isLifted: (plan: LiftPlan) => lift?.plan === plan,

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
      clearPreview();
      unlift();
      for (const l of landing.splice(0)) discard(l);
      clearTimeout(landTimer);
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
