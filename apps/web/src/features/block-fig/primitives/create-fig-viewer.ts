/**
 * The viewer's state and actions: the open page, the camera, the tool, the
 * selection and hover, and view toggles. Everything that asks the engine
 * something goes through here; components only render it.
 */

import type { FigEngine } from '@core/fig-engine/client';
import type {
  LayerRow,
  NodeGeometry,
  PageLayout,
  Rect,
} from '@core/fig-engine/types';
import { batch, createSignal } from 'solid-js';
import {
  type Camera,
  centerOn,
  fitRect,
  type Point,
  panBy,
  type Size,
  screenToPage,
  stepZoom,
  unionRects,
  zoomAt,
} from '../core/camera';
import { clickTarget, doubleClickTarget } from '../core/selection';

export type Tool = 'move' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text';

export interface Selected {
  id: string;
  /** Parent layer id; `null` for the page's children. */
  parent: string | null;
}

export interface FigViewerOptions {
  engine: FigEngine;
  notifyError: (message: string) => void;
}

/** Pick tolerance around thin shapes, in CSS pixels. */
const HIT_SLOP = 3;

export function createFigViewer(options: FigViewerOptions) {
  const { engine } = options;
  const pages = engine.summary.pages;

  const [pageIndex, setPageIndex] = createSignal(0);
  const [layout, setLayout] = createSignal<PageLayout>();
  const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });
  const [viewport, setViewport] = createSignal<Size>({ w: 0, h: 0 });
  const [tool, setTool] = createSignal<Tool>('move');
  const [selected, setSelected] = createSignal<Selected[]>([]);
  const [selectionGeometry, setSelectionGeometry] = createSignal<
    NodeGeometry[]
  >([]);
  const [hover, setHover] = createSignal<LayerRow>();
  const [hoverOutline, setHoverOutline] = createSignal<string>();
  const [hoverBounds, setHoverBounds] = createSignal<Rect>();
  const [outlineView, setOutlineView] = createSignal(false);
  const [rulers, setRulers] = createSignal(false);
  const [pixelGrid, setPixelGrid] = createSignal(true);
  const [uiHidden, setUiHidden] = createSignal(false);
  const [layersOpen, setLayersOpen] = createSignal(true);
  const [designOpen, setDesignOpen] = createSignal(true);
  const [loadingPage, setLoadingPage] = createSignal(true);
  /** Bumped to tell the layers panel to collapse everything. */
  const [collapseSignal, setCollapseSignal] = createSignal(0);
  /** Bumped when the layers panel should reveal the selection. */
  const [revealSignal, setRevealSignal] = createSignal(0);
  /** Bumped after every edit (layers, properties, and geometry reload). */
  const [editVersion, setEditVersion] = createSignal(0);
  /** Bumped to start renaming the selected layer in the layers panel. */
  const [renameSignal, setRenameSignal] = createSignal(0);

  const cameras = new Map<number, Camera>();
  const outlines = new Map<string, { path: string; bounds: Rect }>();

  const page = () => pageIndex();
  const contentBounds = (): Rect | undefined => {
    const b = layout()?.bounds;
    return b && Number.isFinite(b.x) && b.w >= 0 ? b : undefined;
  };

  const fitAll = (
    maxZoom = 1,
    bounds: Rect | undefined = contentBounds()
  ): Camera | undefined => {
    const v = viewport();
    if (!bounds || !Number.isFinite(bounds.x) || v.w <= 0) return undefined;
    return fitRect(bounds, v, maxZoom);
  };

  // ---- pages ----------------------------------------------------------

  let pageRequest = 0;
  const openPage = async (index: number) => {
    if (index < 0 || index >= pages.length) return;
    const request = ++pageRequest;
    if (layout() && viewport().w > 0) cameras.set(pageIndex(), camera());
    setLoadingPage(true);
    try {
      const next = await engine.openPage(index);
      if (request !== pageRequest) return;
      outlines.clear();
      batch(() => {
        setPageIndex(index);
        setLayout(next);
        setSelected([]);
        setSelectionGeometry([]);
        setHover(undefined);
        setHoverOutline(undefined);
        const remembered = cameras.get(index);
        const fitted = fitAll(1, next.bounds);
        if (remembered) setCamera(remembered);
        else if (fitted) setCamera(fitted);
        setLoadingPage(false);
      });
    } catch (e) {
      setLoadingPage(false);
      options.notifyError(e instanceof Error ? e.message : String(e));
    }
  };

  const resize = (size: Size) => {
    const first = viewport().w <= 0 && size.w > 0;
    setViewport(size);
    if (first && layout() && !cameras.has(pageIndex())) {
      const fitted = fitAll();
      if (fitted) setCamera(fitted);
    }
  };

  // ---- camera ---------------------------------------------------------

  const center = (): Point => ({ x: viewport().w / 2, y: viewport().h / 2 });
  const zoomTo = (zoom: number, anchor: Point = center()) =>
    setCamera((c) => zoomAt(c, zoom, anchor));
  const zoomBy = (factor: number, anchor: Point) =>
    setCamera((c) => zoomAt(c, c.zoom * factor, anchor));
  const zoomStep = (direction: 1 | -1) =>
    setCamera((c) => zoomAt(c, stepZoom(c.zoom, direction), center()));
  const pan = (dx: number, dy: number) => setCamera((c) => panBy(c, dx, dy));
  const zoomToFit = () => {
    const fitted = fitAll(Number.POSITIVE_INFINITY);
    if (fitted) setCamera(fitted);
  };
  const zoomToRect = (rect: Rect) => {
    if (viewport().w <= 0) return;
    setCamera(fitRect(rect, viewport()));
  };
  const selectionBounds = () =>
    unionRects(selectionGeometry().map((g) => g.bounds));
  const zoomToSelection = () => {
    const b = selectionBounds();
    if (b) zoomToRect(b);
    else zoomToFit();
  };
  const zoom100 = () => zoomTo(1);

  // ---- selection ------------------------------------------------------

  const refreshGeometry = async (ids: string[]) => {
    if (ids.length === 0) {
      setSelectionGeometry([]);
      return;
    }
    try {
      setSelectionGeometry(await engine.geometry(page(), ids));
    } catch {
      setSelectionGeometry([]);
    }
  };

  const select = (next: Selected[]) => {
    setSelected(next);
    void refreshGeometry(next.map((s) => s.id));
    setRevealSignal((n) => n + 1);
  };

  /** Selects layers by id, looking up their parents. */
  const selectIds = async (ids: string[], additive = false) => {
    const found: Selected[] = [];
    for (const id of ids) {
      try {
        const chain = await engine.ancestry(page(), id);
        const at = chain.findIndex((r) => r.id === id);
        found.push({ id, parent: at > 0 ? chain[at - 1].id : null });
      } catch {
        // The layer is gone (another page, or an unknown id).
      }
    }
    if (additive) {
      const current = selected();
      const merged = [...current];
      for (const f of found) {
        const i = merged.findIndex((s) => s.id === f.id);
        if (i >= 0) merged.splice(i, 1);
        else merged.push(f);
      }
      select(merged);
    } else select(found);
  };

  const hitChain = async (screen: Point) => {
    const c = camera();
    const p = screenToPage(c, screen);
    return engine.hitTest(page(), p.x, p.y, HIT_SLOP / c.zoom);
  };

  /** A click on the canvas. */
  const clickAt = async (
    screen: Point,
    mods: { deep: boolean; additive: boolean; double: boolean }
  ) => {
    const chain = await hitChain(screen);
    const context = { selected: selected() };
    const target = mods.double
      ? doubleClickTarget(chain, context)
      : clickTarget(chain, context, mods.deep);
    if (!target) {
      if (!mods.additive) select([]);
      return;
    }
    const at = chain.indexOf(target);
    const entry = { id: target.id, parent: at > 0 ? chain[at - 1].id : null };
    if (mods.additive) {
      const current = selected();
      const exists = current.some((s) => s.id === entry.id);
      select(
        exists ? current.filter((s) => s.id !== entry.id) : [...current, entry]
      );
    } else select([entry]);
  };

  /**
   * A press on the canvas, as Figma handles it: an already selected layer
   * keeps the selection (so a drag moves all of it); anything else selects
   * as a click would. Returns the pressed layer and whether it was selected
   * before, or nothing for empty canvas.
   */
  const pressAt = async (
    screen: Point,
    mods: { deep: boolean; additive: boolean }
  ): Promise<{ row: LayerRow; wasSelected: boolean } | undefined> => {
    const chain = await hitChain(screen);
    const context = { selected: selected() };
    const target = clickTarget(chain, context, mods.deep);
    if (!target) {
      if (!mods.additive) select([]);
      return undefined;
    }
    const wasSelected = selected().some((s) => s.id === target.id);
    if (wasSelected && !mods.additive) return { row: target, wasSelected };
    const at = chain.indexOf(target);
    const entry = { id: target.id, parent: at > 0 ? chain[at - 1].id : null };
    if (mods.additive) {
      const current = selected();
      select(
        wasSelected
          ? current.filter((s) => s.id !== entry.id)
          : [...current, entry]
      );
    } else select([entry]);
    return { row: target, wasSelected };
  };

  /** The deepest frame-like layer under a page point (new layers go in). */
  const containerAt = async (pagePoint: Point): Promise<string> => {
    const chain = await engine.hitTest(page(), pagePoint.x, pagePoint.y, 0);
    for (let i = chain.length - 1; i >= 0; i--) {
      const t = chain[i];
      if (t.id.startsWith('I')) continue;
      if (t.type === 'FRAME' || t.type === 'SYMBOL' || t.type === 'SECTION')
        return t.id;
    }
    return pages[page()].id;
  };

  let hoverRequest = 0;
  /** Hover feedback: what a click would select. */
  const hoverAt = async (screen: Point | undefined, deep: boolean) => {
    const request = ++hoverRequest;
    if (!screen) {
      setHover(undefined);
      setHoverOutline(undefined);
      return;
    }
    const chain = await hitChain(screen);
    if (request !== hoverRequest) return;
    const target = clickTarget(chain, { selected: selected() }, deep);
    if (target?.id === hover()?.id) return;
    setHover(target);
    if (!target) {
      setHoverOutline(undefined);
      setHoverBounds(undefined);
      return;
    }
    await loadOutline(target.id, request);
  };

  const loadOutline = async (id: string, request = hoverRequest) => {
    let cached = outlines.get(id);
    if (!cached) {
      const [path, geometry] = await Promise.all([
        engine.outline(page(), id),
        engine.geometry(page(), [id]),
      ]);
      cached = {
        path,
        bounds: geometry[0]?.bounds ?? { x: 0, y: 0, w: 0, h: 0 },
      };
      outlines.set(id, cached);
    }
    if (request !== hoverRequest) return;
    setHoverOutline(cached.path);
    setHoverBounds(cached.bounds);
  };

  /** Hovering a row in the layers panel highlights it on the canvas. */
  const hoverLayer = (row: LayerRow | undefined) => {
    const request = ++hoverRequest;
    setHover(row);
    if (!row) {
      setHoverOutline(undefined);
      setHoverBounds(undefined);
      return;
    }
    void loadOutline(row.id, request);
  };

  const marqueeSelect = async (rect: Rect, additive: boolean) => {
    // Within the selection's parent when nested, as Figma does.
    const parent = selected()[0]?.parent ?? undefined;
    const ids = await engine.inRect(page(), parent, rect);
    const entries = ids.map((id) => ({ id, parent: parent ?? null }));
    if (additive) {
      const current = selected();
      select([
        ...current,
        ...entries.filter((e) => !current.some((s) => s.id === e.id)),
      ]);
    } else select(entries);
  };

  const selectAll = async () => {
    const parent = selected()[0]?.parent ?? undefined;
    const rows = await engine.layers(page(), parent);
    select(
      rows
        .filter((r) => r.visible && !r.locked)
        .map((r) => ({ id: r.id, parent: parent ?? null }))
    );
  };

  const selectParent = () => {
    const parents = [
      ...new Set(
        selected()
          .map((s) => s.parent)
          .filter((p) => p !== null)
      ),
    ] as string[];
    if (parents.length === 0) {
      select([]);
      return;
    }
    void selectIds(parents);
  };

  const selectChildren = async () => {
    const out: Selected[] = [];
    for (const s of selected()) {
      const rows = await engine.layers(page(), s.id);
      for (const r of rows) out.push({ id: r.id, parent: s.id });
    }
    if (out.length > 0) select(out);
  };

  const selectSibling = async (direction: 1 | -1) => {
    const current = selected()[0];
    if (!current) {
      const rows = await engine.layers(page());
      const first = direction > 0 ? rows[0] : rows[rows.length - 1];
      if (first) select([{ id: first.id, parent: null }]);
      return;
    }
    const rows = await engine.layers(page(), current.parent ?? undefined);
    const at = rows.findIndex((r) => r.id === current.id);
    if (at < 0 || rows.length === 0) return;
    // The layers panel lists top-most first; Tab moves down the list.
    const next = rows[(at + direction + rows.length) % rows.length];
    select([{ id: next.id, parent: current.parent }]);
  };

  const escapeSelection = () => {
    if (selected().length === 0) return;
    selectParent();
  };

  /**
   * Picks up an edit: the page's frames and bounds, selection geometry,
   * and hover outlines are reloaded without moving the camera.
   */
  const afterEdit = async () => {
    outlines.clear();
    setHoverOutline(undefined);
    const index = page();
    try {
      const [next] = await Promise.all([
        engine.openPage(index),
        refreshGeometry(selected().map((s) => s.id)),
      ]);
      if (index !== page()) return;
      batch(() => {
        setLayout(next);
        setEditVersion((n) => n + 1);
      });
    } catch (e) {
      options.notifyError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Drops selected ids that no longer exist (after undo, say). */
  const pruneSelection = async () => {
    const current = selected();
    if (current.length === 0) return;
    const rows = await engine.rows(
      page(),
      current.map((s) => s.id)
    );
    const alive = new Set(rows.map((r) => r.id));
    if (alive.size !== current.length)
      select(current.filter((s) => alive.has(s.id)));
  };

  // ---- frames ---------------------------------------------------------

  const frameIndex = () => {
    const frames = layout()?.frames ?? [];
    const sel = selected()[0];
    if (!sel) return -1;
    return frames.findIndex((f) => f.id === sel.id);
  };

  /** N / ⇧N: the next or previous top-level frame, zoomed to fit. */
  const stepFrame = (direction: 1 | -1) => {
    const frames = (layout()?.frames ?? []).filter((f) =>
      ['FRAME', 'SYMBOL', 'SECTION', 'INSTANCE'].includes(f.type)
    );
    if (frames.length === 0) return;
    const current = frames.findIndex((f) => f.id === selected()[0]?.id);
    const next =
      frames[
        current < 0
          ? direction > 0
            ? 0
            : frames.length - 1
          : (current + direction + frames.length) % frames.length
      ];
    select([{ id: next.id, parent: null }]);
    zoomToRect(next.bounds);
  };

  const revealLayer = (id: string) => {
    void selectIds([id]).then(() => {
      const g = selectionGeometry()[0];
      if (!g) return;
      const v = viewport();
      const c = camera();
      const visible = {
        x: c.x,
        y: c.y,
        w: v.w / c.zoom,
        h: v.h / c.zoom,
      };
      const b = g.bounds;
      const inView =
        b.x >= visible.x &&
        b.y >= visible.y &&
        b.x + b.w <= visible.x + visible.w &&
        b.y + b.h <= visible.y + visible.h;
      if (!inView) setCamera(centerOn(c, b, v));
    });
  };

  return {
    pages,
    page,
    layout,
    contentBounds,
    camera,
    setCamera,
    viewport,
    resize,
    tool,
    setTool,
    selected,
    selectionGeometry,
    selectionBounds,
    hover,
    hoverOutline,
    hoverBounds,
    outlineView,
    setOutlineView,
    rulers,
    setRulers,
    pixelGrid,
    setPixelGrid,
    uiHidden,
    setUiHidden,
    layersOpen,
    setLayersOpen,
    designOpen,
    setDesignOpen,
    loadingPage,
    collapseSignal,
    collapseLayers: () => setCollapseSignal((n) => n + 1),
    revealSignal,
    editVersion,
    renameSignal,
    requestRename: () => setRenameSignal((n) => n + 1),
    afterEdit,
    pruneSelection,
    frameIndex,
    openPage,
    zoomTo,
    zoomBy,
    zoomStep,
    pan,
    zoomToFit,
    zoomToRect,
    zoomToSelection,
    zoom100,
    select,
    selectIds,
    clickAt,
    pressAt,
    containerAt,
    hoverAt,
    hoverLayer,
    marqueeSelect,
    selectAll,
    selectParent,
    selectChildren,
    selectSibling,
    escapeSelection,
    stepFrame,
    revealLayer,
  };
}

export type FigViewer = ReturnType<typeof createFigViewer>;
