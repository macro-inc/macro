/**
 * The editor's view of the document: artboards and the layer tree, the
 * camera, the tool, the selection and what the pointer is over, and view
 * toggles. Everything that asks the engine about the document goes through
 * here; components only render it.
 */

import {
  type Camera,
  centerOn,
  panBy,
  type Size,
  screenToPage,
  stepZoom,
  zoomAt,
} from '@app/features/block-fig/core/camera';
import type { AiEngine } from '@core/ai-engine/client';
import type { EditResult, Info, Row, Summary } from '@core/ai-engine/types';
import { batch, createSignal, onCleanup } from 'solid-js';
import {
  contains,
  type EdgeRect,
  geometricRect,
  type Point,
  type Rect,
  toEdges,
  toRect,
  unionOf,
} from '../core/geometry';
import { ancestorsOf, outermost, selectableIds } from '../core/layers';
import type { Tool } from '../core/tools';
import { fitInside } from '../core/view';

export interface AiViewerOptions {
  engine: AiEngine;
  notifyError: (message: string) => void;
}

/** Pause between edits that ends a stream of them (see `editsSettled`). */
const EDITS_QUIET_MS = 250;

/** Margin around the artwork that tiles cover (points). */
const CONTENT_MARGIN = 64;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createAiViewer(options: AiViewerOptions) {
  const { engine } = options;
  const [summary, setSummary] = createSignal<Summary>(engine.summary);
  const [rows, setRows] = createSignal<Row[]>([]);
  /** The canvas area with artwork or artboards (tiles elsewhere are blank). */
  const [content, setContent] = createSignal<Rect>(
    toRect(engine.summary.canvas)
  );
  const [ready, setReady] = createSignal(false);
  const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });
  const [viewport, setViewport] = createSignal<Size>({ w: 0, h: 0 });
  const [tool, setTool] = createSignal<Tool>('select');
  const [outlineView, setOutlineView] = createSignal(false);
  const [selected, setSelected] = createSignal<number[]>([]);
  /** The selected objects' properties, in selection order. */
  const [infos, setInfos] = createSignal<Info[]>([]);
  /** What a click would select, for its outline. */
  const [hover, setHover] = createSignal<Info>();
  /** The artboard chosen with the artboard tool (or in the list). */
  const [artboard, setArtboardSignal] = createSignal<number>();
  /** Bumped after every edit (properties and geometry reload). */
  const [editVersion, setEditVersion] = createSignal(0);
  /**
   * Bumped after edits too, but once per pause in a stream of them (a
   * drag's steps): for what need not follow every step (the layers list).
   */
  const [editsSettled, setEditsSettled] = createSignal(0);
  /** Bumped when the layers panel should reveal the selection. */
  const [revealSignal, setRevealSignal] = createSignal(0);
  /** Bumped to start renaming the selection's first row. */
  const [renameSignal, setRenameSignal] = createSignal(0);

  let lastEditAt = Number.NEGATIVE_INFINITY;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const noteEdit = () => {
    const now = performance.now();
    const quiet = now - lastEditAt > EDITS_QUIET_MS;
    lastEditAt = now;
    clearTimeout(settleTimer);
    settleTimer = undefined;
    if (quiet) setEditsSettled((n) => n + 1);
    else
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        setEditsSettled((n) => n + 1);
      }, EDITS_QUIET_MS);
  };
  onCleanup(() => clearTimeout(settleTimer));

  const artboards = () => summary().artboards.filter((a) => !a.removed);
  const rowById = () => new Map(rows().map((r) => [r.id, r]));

  const selectionBounds = (): Rect | undefined =>
    unionOf(infos().flatMap((i) => geometricRect(i) ?? []));

  // ---- the document -------------------------------------------------------

  /** Grows the tiled area to cover everything drawn. */
  const loadContent = async () => {
    const layers = rows()
      .filter((r) => r.depth === 0)
      .map((r) => r.id);
    const art = layers.length > 0 ? await engine.bounds(layers) : null;
    const all = unionOf([
      toRect(summary().canvas),
      ...(art ? [toRect(art)] : []),
    ]);
    if (!all) return;
    setContent({
      x: all.x - CONTENT_MARGIN,
      y: all.y - CONTENT_MARGIN,
      w: all.w + 2 * CONTENT_MARGIN,
      h: all.h + 2 * CONTENT_MARGIN,
    });
  };

  const loadRows = async () => {
    setRows(await engine.rows());
  };

  /** Reads the document after opening (rows, the tiled area) and fits it. */
  const load = async () => {
    try {
      await loadRows();
      await loadContent();
      setReady(true);
      if (viewport().w > 0) fitAll();
    } catch (e) {
      options.notifyError(message(e));
    }
  };

  // ---- camera -------------------------------------------------------------

  const viewCenter = (): Point => ({
    x: viewport().w / 2,
    y: viewport().h / 2,
  });

  /** The canvas area the view shows. */
  const visibleRect = (): Rect => {
    const c = camera();
    const v = viewport();
    return { x: c.x, y: c.y, w: v.w / c.zoom, h: v.h / c.zoom };
  };

  const zoomTo = (zoom: number, anchor: Point = viewCenter()) =>
    setCamera((c) => zoomAt(c, zoom, anchor));
  const zoomBy = (factor: number, anchor: Point) =>
    setCamera((c) => zoomAt(c, c.zoom * factor, anchor));
  const zoomStep = (direction: 1 | -1, anchor: Point = viewCenter()) =>
    setCamera((c) => zoomAt(c, stepZoom(c.zoom, direction), anchor));
  const pan = (dx: number, dy: number) => setCamera((c) => panBy(c, dx, dy));
  const zoomToRect = (rect: Rect, maxZoom?: number) => {
    if (viewport().w <= 0 || !(rect.w > 0 && rect.h > 0)) return;
    setCamera(fitInside(rect, viewport(), undefined, maxZoom));
  };

  /** The artboard the view or selection is on (else the first). */
  const activeArtboard = () => {
    const list = artboards();
    const chosen = list.find((a) => a.id === artboard());
    if (chosen) return chosen;
    const sel = selectionBounds();
    const at = sel
      ? { x: sel.x + sel.w / 2, y: sel.y + sel.h / 2 }
      : (() => {
          const v = visibleRect();
          return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
        })();
    return list.find((a) => contains(toRect(a.rect), at)) ?? list[0];
  };

  /** ⌘0: the active artboard in the window. */
  const fitArtboard = (id?: number) => {
    const a =
      id === undefined
        ? activeArtboard()
        : artboards().find((x) => x.id === id);
    if (a) zoomToRect(toRect(a.rect));
  };

  /** ⌥⌘0: every artboard in the window. */
  const fitAll = () => {
    const all = unionOf(artboards().map((a) => toRect(a.rect)));
    if (all) zoomToRect(all);
  };

  const resize = (size: Size) => {
    const first = viewport().w <= 0 && size.w > 0;
    setViewport(size);
    if (first && ready()) fitAll();
  };

  /** Brings a canvas rectangle into view when it is out of it. */
  const reveal = (rect: Rect) => {
    const v = visibleRect();
    const inside =
      rect.x >= v.x &&
      rect.y >= v.y &&
      rect.x + rect.w <= v.x + v.w &&
      rect.y + rect.h <= v.y + v.h;
    if (!inside) setCamera(centerOn(camera(), rect, viewport()));
  };

  // ---- selection ----------------------------------------------------------

  let infoRequest = 0;
  /** Reloads the selected objects' properties. */
  const refreshInfos = async () => {
    const request = ++infoRequest;
    const ids = selected();
    try {
      const loaded = await engine.infos(ids);
      if (request !== infoRequest) return;
      setInfos(loaded.filter((i): i is Info => i !== null));
    } catch {
      if (request === infoRequest) setInfos([]);
    }
  };

  const select = (ids: number[]) => {
    const unique = [...new Set(ids)];
    batch(() => {
      setSelected(unique);
      if (unique.length === 0) setInfos([]);
    });
    void refreshInfos();
    setRevealSignal((n) => n + 1);
  };

  /** Adds or removes ids (⇧-click, ⇧-marquee). */
  const toggle = (ids: number[]) => {
    const current = selected();
    const next = [...current];
    for (const id of ids) {
      const at = next.indexOf(id);
      if (at >= 0) next.splice(at, 1);
      else next.push(id);
    }
    select(next);
  };

  const canvasPoint = (screen: Point) => screenToPage(camera(), screen);

  /** The object under a screen point (`deep`: the object itself). */
  const hitAt = async (screen: Point, deep: boolean) => {
    const p = canvasPoint(screen);
    return engine.hitTest(p.x, p.y, camera().zoom, deep);
  };

  /** A click: selects what is under the pointer (⇧ adds or removes). */
  const clickAt = async (
    screen: Point,
    mods: { deep: boolean; additive: boolean }
  ) => {
    const id = await hitAt(screen, mods.deep);
    if (id === null) {
      if (!mods.additive) select([]);
      return undefined;
    }
    if (mods.additive) toggle([id]);
    else select([id]);
    return id;
  };

  /**
   * A press: an already selected object keeps the selection (so a drag
   * moves all of it); anything else selects as a click would. Returns the
   * pressed object and whether it was selected before.
   */
  const pressAt = async (
    screen: Point,
    mods: { deep: boolean; additive: boolean }
  ): Promise<{ id: number; wasSelected: boolean } | undefined> => {
    const id = await hitAt(screen, mods.deep);
    if (id === null) {
      if (!mods.additive) select([]);
      return undefined;
    }
    const wasSelected = selected().includes(id);
    if (mods.additive) toggle([id]);
    else if (!wasSelected) select([id]);
    return { id, wasSelected };
  };

  let hoverRequest = 0;
  /** What a click at a screen point would select (`undefined`: nothing). */
  const hoverAt = async (screen: Point | undefined, deep: boolean) => {
    const request = ++hoverRequest;
    if (!screen) {
      setHover(undefined);
      return;
    }
    try {
      const id = await hitAt(screen, deep);
      if (request !== hoverRequest) return;
      if (id === null) {
        setHover(undefined);
        return;
      }
      if (hover()?.id === id) return;
      const info = await engine.info(id);
      if (request === hoverRequest) setHover(info ?? undefined);
    } catch {
      if (request === hoverRequest) setHover(undefined);
    }
  };

  /** Hovering a row in the layers panel highlights it on the canvas. */
  const hoverNode = async (id: number | undefined) => {
    const request = ++hoverRequest;
    if (id === undefined) {
      setHover(undefined);
      return;
    }
    try {
      const info = await engine.info(id);
      if (request === hoverRequest) setHover(info ?? undefined);
    } catch {
      if (request === hoverRequest) setHover(undefined);
    }
  };

  /** Selects what a canvas rectangle touches (`deep`: the objects inside groups). */
  const marqueeSelect = async (
    rect: Rect,
    mods: { deep: boolean; additive: boolean }
  ) => {
    const ids = await engine.inRect(toEdges(rect), mods.deep);
    if (mods.additive) {
      const current = selected();
      select([...current, ...ids.filter((id) => !current.includes(id))]);
    } else select(ids);
  };

  /** ⌘A: every object in shown, unlocked layers. */
  const selectAll = () => select(selectableIds(rows()));

  /** Selects ids of objects some step created (the outermost of them). */
  const selectCreated = (created: number[]) => {
    if (created.length === 0) return;
    select(outermost(rows(), created));
  };

  const setArtboard = (id: number | undefined) => setArtboardSignal(id);

  /**
   * Picks up an edit: the summary and layer tree when they changed, the
   * selection's properties, and the tiled area. The camera stays.
   */
  const afterEdit = async (result: EditResult, reloadRows: boolean) => {
    try {
      const work: Promise<unknown>[] = [refreshInfos()];
      if (result.structure)
        work.push((async () => setSummary(await engine.currentSummary()))());
      if (result.structure || reloadRows) work.push(loadRows());
      await Promise.all(work);
      if (result.dirty) {
        const grown = unionOf([content(), toRect(result.dirty)]);
        if (grown) setContent(grown);
      }
      batch(() => {
        setEditVersion((n) => n + 1);
        noteEdit();
        // The chosen artboard may be gone (deleted, or someone else's undo).
        if (
          artboard() !== undefined &&
          !artboards().some((a) => a.id === artboard())
        )
          setArtboardSignal(undefined);
      });
    } catch (e) {
      options.notifyError(message(e));
    }
  };

  /** Drops selected ids that no longer exist (after undo, or someone else's edit). */
  const pruneSelection = () => {
    const alive = rowById();
    const current = selected();
    const kept = current.filter((id) => alive.has(id));
    if (kept.length !== current.length) select(kept);
  };

  /** The layer color of an object (selection highlights draw in it). */
  const layerColor = (id: number): [number, number, number] | undefined => {
    const byId = rowById();
    const layer = ancestorsOf(rows(), id)[0] ?? id;
    return byId.get(layer)?.color ?? undefined;
  };

  return {
    engine,
    summary,
    artboards,
    rows,
    rowById,
    content,
    ready,
    load,
    camera,
    setCamera,
    viewport,
    resize,
    visibleRect,
    tool,
    setTool,
    outlineView,
    setOutlineView,
    selected,
    infos,
    selectionBounds,
    hover,
    setHover,
    artboard,
    setArtboard,
    activeArtboard,
    editVersion,
    editsSettled,
    revealSignal,
    renameSignal,
    requestRename: () => setRenameSignal((n) => n + 1),
    zoomTo,
    zoomBy,
    zoomStep,
    pan,
    zoomToRect,
    fitArtboard,
    fitAll,
    reveal,
    canvasPoint,
    select,
    toggle,
    hitAt,
    clickAt,
    pressAt,
    hoverAt,
    hoverNode,
    marqueeSelect,
    selectAll,
    selectCreated,
    refreshInfos,
    afterEdit,
    pruneSelection,
    layerColor,
  };
}

export type AiViewer = ReturnType<typeof createAiViewer>;

/** The engine's rectangle type, as the views pass it on. */
export type { EdgeRect };
