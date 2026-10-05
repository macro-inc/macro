/**
 * What the tools do with the pointer on the canvas, as Photoshop does it:
 * the Move tool drags layers (picking the one under the pointer), the
 * marquees, lassos, and Magic Wand select (Shift adds, Alt subtracts, both
 * intersect), brushes paint strokes in batches as the pointer moves (one
 * undo step each), the bucket and gradient fill, the Type tool places and
 * edits text, the shape tools draw shape layers, Crop and Free Transform
 * show boxes with handles, and the hand and zoom tools move the view.
 *
 * The canvas view turns DOM events into `CanvasPointer`s and draws
 * `overlay()`; everything here is state and actions, without JSX.
 */

import type { Point } from '@app/features/block-fig/core/camera';
import { screenToPage } from '@app/features/block-fig/core/camera';
import type { IRect, Op, SelectMode, Target } from '@core/psd-engine/types';
import { createSignal } from 'solid-js';
import { brushFor, newStrokeId, type PaintingTool } from '../core/brush';
import { twoColorGradient } from '../core/gradient';
import {
  gestureKey,
  movable,
  newLayerOp,
  paintable,
  paintOp,
} from '../core/ops';
import {
  addLassoPoint,
  closesPolygon,
  marqueeRect,
  selectModeFor,
  toPairs,
} from '../core/selection-math';
import { shapeLayer } from '../core/shapes';
import { intersect, isEmpty } from '../core/tiles';
import type { ToolOverlay, TransformImage } from '../core/tool-overlay';
import { PAINT_TOOLS, SELECTION_TOOLS, type Tool } from '../core/tools';
import {
  dragHandle,
  type FreeTransform,
  type Handle,
  hitTransform,
  isIdentity,
  isTranslation,
  matrixOf,
  moveBy,
  rotateTo,
  startTransform,
} from '../core/transform';
import type { PsdEditor } from './create-psd-editor';
import type { PsdView } from './create-psd-view';

/** A pointer event, as the tools see it. */
export interface CanvasPointer {
  /** CSS pixels within the canvas element. */
  screen: Point;
  /** Canvas (document) pixels. */
  at: Point;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  /** Pen pressure, `0..=1` (1 for a mouse). */
  pressure: number;
  /** Points the browser coalesced since the last event (painting). */
  trail?: { at: Point; pressure: number }[];
}

/** Pointer travel (CSS px) that turns a click into a drag. */
const DRAG_THRESHOLD = 3;
/** Handles take a press within this many CSS pixels. */
const HANDLE_SLOP = 7;
/** A polygon closes when clicked within this many CSS pixels of its start. */
const CLOSE_SLOP = 8;

type Gesture =
  | { kind: 'pan'; last: Point }
  | {
      kind: 'move';
      start: Point;
      pick: Promise<MovePick>;
      sent: { dx: number; dy: number };
      want: { dx: number; dy: number };
      inFlight: boolean;
      key: string;
    }
  | {
      kind: 'marquee';
      shape: 'rect' | 'ellipse';
      start: Point;
      current: Point;
      mode: SelectMode;
      startMods: { shift: boolean; alt: boolean };
      dragged: boolean;
      screenStart: Point;
    }
  | { kind: 'lasso'; points: Point[]; mode: SelectMode }
  | { kind: 'gradient'; from: Point; to: Point }
  | {
      kind: 'shape';
      shape: 'rectangle' | 'ellipse';
      start: Point;
      current: Point;
      startMods: { shift: boolean; alt: boolean };
    }
  | { kind: 'eyedropper' }
  | { kind: 'crop-draw'; start: Point }
  | {
      kind: 'box';
      target: 'crop' | 'transform';
      part: BoxPart;
      from: Point;
      box: FreeTransform;
    }
  | { kind: 'paint' }
  | { kind: 'zoom'; start: Point; screenStart: Point };

/**
 * What a Move drag takes, decided when it starts and acted on once it moves:
 * the layers (copies of them when `copy`), or why they can't move.
 */
type MovePick =
  | { ids: number[]; copy: boolean }
  | { blocked: string }
  | undefined;

type BoxPart =
  | { kind: 'handle'; handle: Handle }
  | { kind: 'move' }
  | { kind: 'rotate' };

interface Stroke {
  id: number;
  layer: number;
  target: Target;
  key: string;
  buffer: [number, number, number][];
  inFlight: boolean;
  done: boolean;
  /** A point came near enough the document to paint on it. */
  entered: boolean;
  last: Point;
}

export interface CanvasToolsOptions {
  editor: PsdEditor;
  view: PsdView;
  notifyError: (message: string) => void;
  /** Space or the middle button is held: the pointer pans. */
  panning: () => boolean;
  /** Starts typing into a text layer, or new text at a canvas point. */
  onType: (target: { layer: number } | { at: Point }) => void;
}

export function createCanvasTools(options: CanvasToolsOptions) {
  const { editor, view } = options;
  const engine = editor.engine;
  const [overlay, setOverlay] = createSignal<ToolOverlay>({});
  const [transform, setTransform] = createSignal<{
    box: FreeTransform;
    ids: number[];
    images: TransformImage[];
  }>();
  const [crop, setCrop] = createSignal<FreeTransform>();
  const [polygon, setPolygon] = createSignal<{
    points: Point[];
    mode: SelectMode;
  }>();
  const [cursorOverride, setCursorOverride] = createSignal<string>();
  let gesture: Gesture | undefined;
  let stroke: Stroke | undefined;
  /** Where the last stroke ended (Shift-click paints a line from it). */
  let lastPaint: Point | undefined;
  let hoverAt: Point | undefined;
  let gestureCount = 0;

  const zoom = () => view.camera().zoom;
  const canvasRect = (): IRect => {
    const d = editor.docSize();
    return { x: 0, y: 0, w: d.width, h: d.height };
  };

  // ---- the overlay -----------------------------------------------------------

  const refreshOverlay = () => {
    const next: ToolOverlay = {};
    const t = transform();
    if (t) next.transform = { box: t.box, images: t.images };
    const c = crop();
    if (c) next.crop = boxRect(c);
    const p = polygon();
    if (p)
      next.lasso = {
        points: p.points,
        cursor: hoverAt,
        closing:
          !!hoverAt && closesPolygon(p.points, hoverAt, CLOSE_SLOP / zoom()),
      };
    const g = gesture;
    if (g?.kind === 'marquee' && g.dragged)
      next.marquee = { kind: g.shape, rect: marqueeFor(g) };
    if (g?.kind === 'lasso') next.lasso = { points: g.points, closing: false };
    if (g?.kind === 'gradient') next.line = [g.from, g.to];
    if (g?.kind === 'shape')
      next.shape = { kind: g.shape, rect: shapeRectFor(g) };
    const tool = view.tool();
    if (
      hoverAt &&
      !t &&
      (tool === 'brush' || tool === 'pencil' || tool === 'eraser')
    )
      next.brush = { at: hoverAt, size: view.brush().size };
    setOverlay(next);
  };

  const boxRect = (b: FreeTransform): IRect => ({
    x: Math.round(b.cx - Math.abs(b.w) / 2),
    y: Math.round(b.cy - Math.abs(b.h) / 2),
    w: Math.round(Math.abs(b.w)),
    h: Math.round(Math.abs(b.h)),
  });

  const marqueeFor = (g: Extract<Gesture, { kind: 'marquee' }>) =>
    marqueeRect(g.start, g.current, {
      square: g.startMods.shift ? false : lastMods.shift,
      centered: g.startMods.alt ? false : lastMods.alt,
    });

  const shapeRectFor = (g: Extract<Gesture, { kind: 'shape' }>) =>
    marqueeRect(g.start, g.current, {
      square: lastMods.shift,
      centered: lastMods.alt,
    });

  let lastMods = { shift: false, alt: false };

  // ---- painting ----------------------------------------------------------------

  /** Whether a dab at any of the points could touch the document. */
  const reachesDocument = (points: [number, number, number][]) => {
    const { width, height } = editor.docSize();
    const r = view.brush().size / 2 + 1;
    return points.some(
      ([x, y]) => x > -r && y > -r && x < width + r && y < height + r
    );
  };

  const flushStroke = () => {
    const s = stroke;
    if (!s || s.inFlight) return;
    if (s.buffer.length === 0 && !s.done) return;
    // Nothing is sent (no undo step) until the stroke reaches the document.
    if (!s.entered) {
      s.entered = reachesDocument(s.buffer);
      if (!s.entered) {
        if (s.done && stroke === s) stroke = undefined;
        return;
      }
    }
    const points = s.buffer.splice(0);
    const done = s.done;
    s.inFlight = true;
    const tool = view.tool();
    const painting: PaintingTool =
      tool === 'pencil' ? 'pencil' : tool === 'eraser' ? 'eraser' : 'brush';
    const color = painting === 'eraser' ? view.background() : view.foreground();
    const send = async () => {
      await editor.apply(
        [
          paintOp({
            layer: s.layer,
            target: s.target,
            stroke: s.id,
            brush: brushFor(painting, view.brush(), color),
            points,
            done,
          }),
        ],
        s.key
      );
      s.inFlight = false;
      if (done) {
        if (stroke === s) stroke = undefined;
        return;
      }
      if (s.buffer.length > 0 || s.done) flushStroke();
    };
    void send();
  };

  let frame: number | undefined;
  const flushSoon = () => {
    if (frame !== undefined) return;
    const run = () => {
      frame = undefined;
      flushStroke();
    };
    // Hidden tabs do not run animation frames: fall back to a timer.
    frame =
      typeof requestAnimationFrame === 'function' &&
      document.visibilityState === 'visible'
        ? requestAnimationFrame(run)
        : (setTimeout(run, 16) as unknown as number);
  };

  const startStroke = (p: CanvasPointer) => {
    const row = editor.activeRow();
    const target = editor.target();
    if (!row) {
      options.notifyError('Choose a layer to paint on.');
      return false;
    }
    if (!paintable(row, target)) {
      options.notifyError(
        row.kind === 'pixel'
          ? `"${row.name}" is locked against painting.`
          : `Rasterize "${row.name}" before painting on it.`
      );
      return false;
    }
    const id = newStrokeId();
    stroke = {
      id,
      layer: row.id,
      target,
      key: gestureKey('stroke', id),
      buffer: [],
      inFlight: false,
      done: false,
      entered: false,
      last: p.at,
    };
    if (p.shift && lastPaint)
      stroke.buffer.push([lastPaint.x, lastPaint.y, p.pressure]);
    stroke.buffer.push([p.at.x, p.at.y, p.pressure]);
    flushStroke();
    return true;
  };

  const extendStroke = (p: CanvasPointer) => {
    const s = stroke;
    if (!s) return;
    const trail =
      p.trail && p.trail.length > 0
        ? p.trail
        : [{ at: p.at, pressure: p.pressure }];
    for (const t of trail) s.buffer.push([t.at.x, t.at.y, t.pressure]);
    s.last = p.at;
    flushSoon();
  };

  const endStroke = () => {
    const s = stroke;
    if (!s) return;
    s.done = true;
    lastPaint = s.last;
    flushStroke();
  };

  // ---- moving --------------------------------------------------------------------

  const flushMove = () => {
    const g = gesture;
    if (g?.kind !== 'move' || g.inFlight) return;
    const dx = g.want.dx - g.sent.dx;
    const dy = g.want.dy - g.sent.dy;
    if (dx === 0 && dy === 0) return;
    g.inFlight = true;
    const run = async () => {
      // Returning without clearing `inFlight` ends the drag's moves.
      const pick = await g.pick;
      if (!pick || ('ids' in pick && pick.ids.length === 0)) return;
      if ('blocked' in pick) {
        // Said once a drag moves, not for a click.
        options.notifyError(pick.blocked);
        return;
      }
      let ids = pick.ids;
      if (pick.copy) {
        // ⌥-drag moves a copy, made as the drag starts moving.
        const result = await editor.apply([{ op: 'duplicate', ids }], g.key);
        if (!result || result.created.length === 0) return;
        ids = result.created;
        g.pick = Promise.resolve({ ids, copy: false });
      }
      g.sent = { dx: g.sent.dx + dx, dy: g.sent.dy + dy };
      await editor.apply([{ op: 'translate', ids, dx, dy }], g.key);
      g.inFlight = false;
      flushMove();
    };
    void run();
  };

  /** The layers a Move drag takes: the one under the pointer, or the chosen. */
  const pickForMove = async (p: CanvasPointer): Promise<MovePick> => {
    let ids = editor.selected();
    if (view.toolOptions().autoSelect && !p.shift) {
      const hit = await engine.hitTest(p.at.x, p.at.y);
      if (hit !== null && !ids.includes(hit)) {
        editor.chooseLayers([hit]);
        ids = [hit];
      }
    }
    const rows = editor.layers().filter((r) => ids.includes(r.id));
    const locked = rows.find((r) => !movable(r));
    if (locked)
      return {
        blocked: locked.background
          ? 'The Background layer cannot be moved.'
          : `"${locked.name}" is locked in place.`,
      };
    return { ids: rows.map((r) => r.id), copy: p.alt && rows.length > 0 };
  };

  /** Arrow keys: whole pixels (one undo step for a run of presses). */
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  let nudgeKey = 0;
  const nudge = (dx: number, dy: number) => {
    const t = transform();
    if (t) {
      setTransform({ ...t, box: moveBy(t.box, dx, dy) });
      refreshOverlay();
      return;
    }
    const rows = editor
      .layers()
      .filter((r) => editor.selected().includes(r.id));
    if (rows.length === 0 || rows.some((r) => !movable(r))) return;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => nudgeKey++, 800);
    void editor.apply(
      [{ op: 'translate', ids: rows.map((r) => r.id), dx, dy }],
      gestureKey('nudge', nudgeKey)
    );
  };

  // ---- Free Transform ---------------------------------------------------------------

  const loadImages = async (ids: number[]): Promise<TransformImage[]> => {
    const images: TransformImage[] = [];
    for (const row of editor.layers().filter((r) => ids.includes(r.id))) {
      if (!row.bounds || !row.visible) continue;
      try {
        const blob = await engine.exportPng(row.id);
        if (blob.size === 0) continue;
        const image = await createImageBitmap(blob);
        images.push({ image, x: row.bounds.x, y: row.bounds.y });
      } catch {
        // Drawn without a preview.
      }
    }
    return images;
  };

  const startFreeTransform = async () => {
    if (!editor.enabled() || transform()) return;
    const rows = editor
      .layers()
      .filter((r) => editor.selected().includes(r.id));
    if (rows.length === 0) return;
    const locked = rows.find((r) => !movable(r));
    if (locked) {
      options.notifyError(
        locked.background
          ? 'Convert the Background to a layer to transform it.'
          : `"${locked.name}" is locked in place.`
      );
      return;
    }
    let bounds: IRect | undefined;
    for (const r of rows)
      if (r.bounds)
        bounds = bounds
          ? {
              x: Math.min(bounds.x, r.bounds.x),
              y: Math.min(bounds.y, r.bounds.y),
              w:
                Math.max(bounds.x + bounds.w, r.bounds.x + r.bounds.w) -
                Math.min(bounds.x, r.bounds.x),
              h:
                Math.max(bounds.y + bounds.h, r.bounds.y + r.bounds.h) -
                Math.min(bounds.y, r.bounds.y),
            }
          : r.bounds;
    if (!bounds || isEmpty(bounds)) {
      options.notifyError('The layer is empty: there is nothing to transform.');
      return;
    }
    const ids = rows.map((r) => r.id);
    const images = await loadImages(ids);
    setTransform({ box: startTransform(bounds), ids, images });
    await editor.beginTransform(ids);
    refreshOverlay();
  };

  const finishTransform = async (apply: boolean) => {
    const t = transform();
    if (!t) return;
    setTransform(undefined);
    for (const i of t.images)
      if ('close' in i.image && typeof i.image.close === 'function')
        i.image.close();
    refreshOverlay();
    let ops: Op[] | undefined;
    if (apply && !isIdentity(t.box)) {
      if (isTranslation(t.box)) {
        const dx = Math.round(t.box.cx - (t.box.start.x + t.box.start.w / 2));
        const dy = Math.round(t.box.cy - (t.box.start.y + t.box.start.h / 2));
        ops = [{ op: 'translate', ids: t.ids, dx, dy }];
      } else
        ops = [
          {
            op: 'transform',
            ids: t.ids,
            matrix: matrixOf(t.box),
            interpolation: 'bicubic',
          },
        ];
    }
    await editor.endTransform(ops);
  };

  // ---- crop ------------------------------------------------------------------------

  const startCrop = () => {
    if (crop()) return;
    setCrop(startTransform(canvasRect()));
    refreshOverlay();
  };

  const finishCrop = async (apply: boolean) => {
    const c = crop();
    if (!c) return;
    setCrop(undefined);
    refreshOverlay();
    if (!apply) return;
    const rect = boxRect(c);
    const whole = canvasRect();
    if (
      rect.w < 1 ||
      rect.h < 1 ||
      (rect.x === 0 && rect.y === 0 && rect.w === whole.w && rect.h === whole.h)
    )
      return;
    await editor.apply([{ op: 'crop', rect }]);
  };

  // ---- polygonal lasso ---------------------------------------------------------------

  const finishPolygon = async (apply: boolean) => {
    const p = polygon();
    if (!p) return;
    setPolygon(undefined);
    refreshOverlay();
    if (!apply || p.points.length < 3) return;
    await editor.select({
      type: 'polygon',
      points: toPairs(p.points),
      mode: p.mode,
      feather: view.toolOptions().feather,
      antialias: view.toolOptions().antialias,
    });
  };

  // ---- pointer -------------------------------------------------------------------------

  const fillTarget = () => {
    const row = editor.activeRow();
    const target = editor.target();
    if (!row) return undefined;
    if (!paintable(row, target)) {
      options.notifyError(
        row.kind === 'pixel'
          ? `"${row.name}" is locked against painting.`
          : `Rasterize "${row.name}" before filling it.`
      );
      return undefined;
    }
    return { id: row.id, target };
  };

  const editable = () => editor.enabled();

  const down = (p: CanvasPointer, button: number) => {
    lastMods = { shift: p.shift, alt: p.alt };
    const tool = view.tool();
    if (button === 1 || options.panning() || tool === 'hand') {
      gesture = { kind: 'pan', last: p.screen };
      return;
    }
    if (button !== 0) return;
    const t = transform();
    if (t) {
      const part = hitTransform(t.box, p.at, HANDLE_SLOP / zoom());
      if (part)
        gesture = {
          kind: 'box',
          target: 'transform',
          part,
          from: p.at,
          box: t.box,
        };
      return;
    }
    if (tool === 'crop') {
      if (!editable()) return;
      const c = crop();
      const part = c
        ? hitTransform({ ...c, angle: 0 }, p.at, HANDLE_SLOP / zoom())
        : undefined;
      if (c && part && part.kind !== 'rotate') {
        gesture = { kind: 'box', target: 'crop', part, from: p.at, box: c };
        return;
      }
      gesture = { kind: 'crop-draw', start: p.at };
      setCrop(
        startTransform({
          x: Math.round(p.at.x),
          y: Math.round(p.at.y),
          w: 1,
          h: 1,
        })
      );
      refreshOverlay();
      return;
    }
    if (
      PAINT_TOOLS.has(tool) ||
      tool === 'move' ||
      tool === 'type' ||
      tool === 'rectangle' ||
      tool === 'ellipse'
    ) {
      if (!editable()) return;
    }
    const mode = selectModeFor({ shift: p.shift, alt: p.alt });
    switch (tool) {
      case 'move': {
        gesture = {
          kind: 'move',
          start: p.at,
          pick: pickForMove(p),
          sent: { dx: 0, dy: 0 },
          want: { dx: 0, dy: 0 },
          inFlight: false,
          key: gestureKey('move', ++gestureCount),
        };
        return;
      }
      case 'marqueeRect':
      case 'marqueeEllipse':
        gesture = {
          kind: 'marquee',
          shape: tool === 'marqueeRect' ? 'rect' : 'ellipse',
          start: p.at,
          current: p.at,
          mode,
          startMods: { shift: p.shift, alt: p.alt },
          dragged: false,
          screenStart: p.screen,
        };
        return;
      case 'lasso':
        gesture = { kind: 'lasso', points: [p.at], mode };
        refreshOverlay();
        return;
      case 'polygonLasso': {
        const poly = polygon();
        if (!poly) {
          setPolygon({ points: [p.at], mode });
        } else if (closesPolygon(poly.points, p.at, CLOSE_SLOP / zoom())) {
          void finishPolygon(true);
        } else setPolygon({ ...poly, points: [...poly.points, p.at] });
        refreshOverlay();
        return;
      }
      case 'wand':
        void editor.select({
          type: 'wand',
          x: Math.floor(p.at.x),
          y: Math.floor(p.at.y),
          tolerance: view.toolOptions().tolerance,
          contiguous: view.toolOptions().contiguous,
          antialias: view.toolOptions().antialias,
          sampleAll: view.toolOptions().sampleAll,
          layer: editor.active() ?? null,
          mode,
        });
        return;
      case 'eyedropper':
        gesture = { kind: 'eyedropper' };
        void sampleColor(p);
        return;
      case 'brush':
      case 'pencil':
      case 'eraser':
        if (startStroke(p)) gesture = { kind: 'paint' };
        return;
      case 'bucket': {
        const t = fillTarget();
        if (!t) return;
        void editor.apply([
          {
            op: 'bucket',
            id: t.id,
            target: t.target,
            x: Math.floor(p.at.x),
            y: Math.floor(p.at.y),
            color: view.foreground(),
            opacity: 1,
            tolerance: view.toolOptions().tolerance,
            contiguous: view.toolOptions().contiguous,
            antialias: view.toolOptions().antialias,
            sampleAll: view.toolOptions().sampleAll,
          },
        ]);
        return;
      }
      case 'gradient':
        if (!fillTarget()) return;
        gesture = { kind: 'gradient', from: p.at, to: p.at };
        refreshOverlay();
        return;
      case 'type':
        void typeAt(p);
        return;
      case 'rectangle':
      case 'ellipse':
        gesture = {
          kind: 'shape',
          shape: tool,
          start: p.at,
          current: p.at,
          startMods: { shift: p.shift, alt: p.alt },
        };
        return;
      case 'zoom':
        gesture = { kind: 'zoom', start: p.at, screenStart: p.screen };
        return;
      default:
        return;
    }
  };

  const move = (p: CanvasPointer) => {
    lastMods = { shift: p.shift, alt: p.alt };
    hoverAt = p.at;
    const g = gesture;
    if (!g) {
      const t = transform();
      if (t) {
        const part = hitTransform(t.box, p.at, HANDLE_SLOP / zoom());
        setCursorOverride(part ? partCursor(part) : undefined);
      } else if (crop() && view.tool() === 'crop') {
        const c = crop();
        const part = c
          ? hitTransform({ ...c, angle: 0 }, p.at, HANDLE_SLOP / zoom())
          : undefined;
        setCursorOverride(
          part && part.kind !== 'rotate' ? partCursor(part) : undefined
        );
      } else setCursorOverride(undefined);
      refreshOverlay();
      return;
    }
    switch (g.kind) {
      case 'pan':
        view.pan(p.screen.x - g.last.x, p.screen.y - g.last.y);
        g.last = p.screen;
        return;
      case 'move':
        g.want = {
          dx: Math.round(p.at.x - g.start.x),
          dy: Math.round(p.at.y - g.start.y),
        };
        flushMove();
        return;
      case 'marquee':
        g.current = p.at;
        if (
          Math.hypot(
            p.screen.x - g.screenStart.x,
            p.screen.y - g.screenStart.y
          ) >= DRAG_THRESHOLD
        )
          g.dragged = true;
        break;
      case 'lasso':
        g.points = addLassoPoint(g.points, p.at, 1 / zoom());
        break;
      case 'gradient':
        g.to = p.shift ? snapLine(g.from, p.at) : p.at;
        break;
      case 'shape':
        g.current = p.at;
        break;
      case 'eyedropper':
        void sampleColor(p);
        return;
      case 'crop-draw': {
        const r = marqueeRect(g.start, p.at, {
          square: p.shift,
          centered: p.alt,
        });
        setCrop(
          startTransform({ ...r, w: Math.max(1, r.w), h: Math.max(1, r.h) })
        );
        break;
      }
      case 'box': {
        const next = moveBox(g, p);
        if (g.target === 'transform') {
          const t = transform();
          if (t) setTransform({ ...t, box: next });
        } else setCrop({ ...next, angle: 0 });
        break;
      }
      case 'paint':
        extendStroke(p);
        refreshOverlay();
        return;
      case 'zoom':
        return;
    }
    refreshOverlay();
  };

  const moveBox = (
    g: Extract<Gesture, { kind: 'box' }>,
    p: CanvasPointer
  ): FreeTransform => {
    if (g.part.kind === 'move')
      return moveBy(g.box, p.at.x - g.from.x, p.at.y - g.from.y);
    if (g.part.kind === 'rotate')
      return rotateTo(g.box, g.box.angle, g.from, p.at, p.shift);
    return dragHandle(g.box, g.part.handle, p.at, {
      // Corners keep proportions unless Shift (Photoshop since 2019); the
      // crop box is free unless Shift.
      proportional: g.target === 'transform' ? !p.shift : p.shift,
      centered: p.alt,
    });
  };

  const up = (p: CanvasPointer) => {
    const g = gesture;
    gesture = undefined;
    if (!g) return;
    switch (g.kind) {
      case 'move':
        g.want = {
          dx: Math.round(p.at.x - g.start.x),
          dy: Math.round(p.at.y - g.start.y),
        };
        flushMove();
        break;
      case 'marquee': {
        const rect = marqueeFor({ ...g, current: p.at });
        if (!g.dragged || rect.w < 1 || rect.h < 1) {
          // A click deselects (unless it adds to or subtracts from it).
          if (g.mode === 'replace') void editor.select({ type: 'none' });
          break;
        }
        void editor.select({
          type: g.shape,
          ...rect,
          mode: g.mode,
          feather: view.toolOptions().feather,
          ...(g.shape === 'ellipse'
            ? { antialias: view.toolOptions().antialias }
            : {}),
        });
        break;
      }
      case 'lasso':
        if (g.points.length >= 3)
          void editor.select({
            type: 'polygon',
            points: toPairs(g.points),
            mode: g.mode,
            feather: view.toolOptions().feather,
            antialias: view.toolOptions().antialias,
          });
        else if (g.mode === 'replace') void editor.select({ type: 'none' });
        break;
      case 'gradient': {
        const t = fillTarget();
        if (!t) break;
        const to = p.shift ? snapLine(g.from, p.at) : p.at;
        if (Math.hypot(to.x - g.from.x, to.y - g.from.y) < 1) break;
        void editor.apply([
          {
            op: 'gradient',
            id: t.id,
            target: t.target,
            gradient: {
              ...twoColorGradient(
                view.foreground(),
                view.background(),
                'Foreground to Background',
                view.toolOptions().gradientMethod
              ),
              kind: view.toolOptions().gradient,
            },
            from: [g.from.x, g.from.y],
            to: [to.x, to.y],
            opacity: 1,
          },
        ]);
        break;
      }
      case 'shape': {
        const rect = shapeRectFor({ ...g, current: p.at });
        if (rect.w < 2 || rect.h < 2) break;
        void editor.apply([
          newLayerOp(
            editor.activeRow(),
            shapeLayer(g.shape, rect, view.foreground())
          ),
        ]);
        break;
      }
      case 'paint':
        endStroke();
        break;
      case 'zoom': {
        const out = p.alt;
        view.zoomStep(out ? -1 : 1, p.screen);
        break;
      }
      case 'crop-draw': {
        const c = crop();
        if (c && (Math.abs(c.w) < 2 || Math.abs(c.h) < 2))
          setCrop(startTransform(canvasRect()));
        break;
      }
      default:
        break;
    }
    refreshOverlay();
  };

  const hover = (p: CanvasPointer | null) => {
    hoverAt = p?.at;
    if (!p) setCursorOverride(undefined);
    refreshOverlay();
  };

  const doubleClick = (p: CanvasPointer) => {
    if (polygon()) {
      void finishPolygon(true);
      return;
    }
    if (transform()) {
      void finishTransform(true);
      return;
    }
    if (view.tool() === 'crop' && crop()) {
      void finishCrop(true);
      return;
    }
    if (view.tool() === 'move' && editable()) void editTextAt(p);
  };

  /** Double-click with the Move tool on text edits it. */
  const editTextAt = async (p: CanvasPointer) => {
    const hit = await engine.hitTest(p.at.x, p.at.y);
    const row = editor.layers().find((r) => r.id === hit);
    if (row?.kind === 'text') {
      editor.chooseLayers([row.id]);
      options.onType({ layer: row.id });
    }
  };

  const typeAt = async (p: CanvasPointer) => {
    const hit = await engine.hitTest(p.at.x, p.at.y);
    const row = editor.layers().find((r) => r.id === hit);
    if (row?.kind === 'text') {
      editor.chooseLayers([row.id]);
      options.onType({ layer: row.id });
    } else options.onType({ at: p.at });
  };

  const sampleColor = async (p: CanvasPointer) => {
    const d = editor.docSize();
    if (p.at.x < 0 || p.at.y < 0 || p.at.x >= d.width || p.at.y >= d.height)
      return;
    const [r, g, b, a] = await engine.sample(p.at.x, p.at.y);
    if (a === 0) return;
    const color = { r: r / 255, g: g / 255, b: b / 255 };
    if (p.alt) view.setBackground(color);
    else view.setForeground(color);
  };

  /** Ends whatever a press started (pointer cancelled, window blurred). */
  const cancelGesture = () => {
    const g = gesture;
    gesture = undefined;
    if (g?.kind === 'paint') endStroke();
    refreshOverlay();
  };

  /** Enter: commits Free Transform, the crop, or a polygon. */
  const commit = (): boolean => {
    if (transform()) {
      void finishTransform(true);
      return true;
    }
    if (crop() && view.tool() === 'crop') {
      void finishCrop(true);
      return true;
    }
    if (polygon()) {
      void finishPolygon(true);
      return true;
    }
    return false;
  };

  /** Escape: cancels them. */
  const cancel = (): boolean => {
    if (transform()) {
      void finishTransform(false);
      return true;
    }
    if (crop()) {
      void finishCrop(false);
      return true;
    }
    if (polygon()) {
      void finishPolygon(false);
      return true;
    }
    return false;
  };

  /** The tool changed: boxes that belong to the previous one end. */
  const toolChanged = (tool: Tool) => {
    if (tool !== 'crop' && crop()) void finishCrop(false);
    if (tool === 'crop' && editable()) startCrop();
    if (tool !== 'polygonLasso' && polygon()) void finishPolygon(false);
    refreshOverlay();
  };

  const cursor = () => {
    if (gesture?.kind === 'pan') return 'grabbing';
    if (options.panning()) return 'grab';
    const override = cursorOverride();
    if (override) return override;
    const tool = view.tool();
    if (tool === 'hand') return 'grab';
    if (tool === 'zoom') return lastMods.alt ? 'zoom-out' : 'zoom-in';
    if (tool === 'type') return 'text';
    if (tool === 'move') return 'move';
    if (tool === 'brush' || tool === 'pencil' || tool === 'eraser')
      return 'none';
    if (SELECTION_TOOLS.has(tool) || tool === 'crop') return 'crosshair';
    return 'crosshair';
  };

  return {
    overlay,
    cursor,
    down,
    move,
    up,
    hover,
    doubleClick,
    cancelGesture,
    commit,
    cancel,
    nudge,
    toolChanged,
    refreshOverlay,
    transforming: () => !!transform(),
    startFreeTransform,
    finishTransform,
    cropping: () => !!crop(),
    finishCrop,
    polygonOpen: () => !!polygon(),
    /** Whether a gesture is under way. */
    busy: () => gesture !== undefined || !!stroke,
  };
}

/** A line snapped to 45° steps (Shift with the gradient tool). */
function snapLine(from: Point, p: Point): Point {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = Math.hypot(dx, dy);
  return {
    x: from.x + Math.cos(angle) * len,
    y: from.y + Math.sin(angle) * len,
  };
}

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function partCursor(part: BoxPart): string {
  if (part.kind === 'move') return 'move';
  if (part.kind === 'rotate') return 'alias';
  return HANDLE_CURSORS[part.handle];
}

/** Canvas pixels from a screen point. */
export function toCanvas(
  camera: Parameters<typeof screenToPage>[0],
  screen: Point
): Point {
  return screenToPage(camera, screen);
}

/** Whether a rectangle meets the canvas. */
export function onCanvas(rect: IRect, width: number, height: number) {
  return !isEmpty(intersect(rect, { x: 0, y: 0, w: width, h: height }));
}

export type CanvasTools = ReturnType<typeof createCanvasTools>;
