/**
 * Illustrator's pointer gestures on the canvas, for each tool. Space-drag,
 * middle-drag, touch, and the hand tool pan; two fingers pinch; the zoom
 * tool zooms in (⌥: out) or to a dragged area. When the document is
 * editable: the selection tool moves (⌥ copies, ⇧ constrains), scales by
 * the bounding box's handles (⇧ keeps proportions, ⌥ from the center), and
 * rotates just outside its corners (⇧ by 45°); direct selection drags
 * anchor points and handles; the shape tools draw by dragging (⇧ square,
 * ⌥ from the center); the pen places corners (click) and smooth points
 * (drag) and closes on its first point; the type tool makes point text
 * (click) or area text (drag); the eyedropper takes an object's fill and
 * stroke; the artboard tool picks, moves, resizes, and draws artboards.
 */

import {
  pageToScreen,
  screenToPage,
} from '@app/features/block-fig/core/camera';
import { createEffect, on } from 'solid-js';
import { match, P } from 'ts-pattern';
import {
  apply,
  center,
  constrainAngle,
  contains,
  dragAngle,
  type Handle,
  handleAt,
  invert,
  type Matrix,
  type Point,
  type Rect,
  resizeBox,
  resizeMatrix,
  rotateAbout,
  rotatesAt,
  shapeRect,
  spanRect,
  toRect,
} from '../core/geometry';
import {
  type Anchor,
  anchorsOf,
  canvasAnchors,
  closesPen,
  moveAnchor,
  moveHandle,
  type PathData,
  penHandle,
  penPath,
} from '../core/path';
import { ellipsePath, polygonPath, rectPath } from '../core/shapes';
import {
  isShapeTool,
  POLYGON_SIDES,
  type ShapeTool,
  STAR_INNER,
  STAR_POINTS,
} from '../core/tools';
import { type AiEditor, TEXT_DEFAULTS } from './create-ai-editor';
import type { AiViewer } from './create-ai-viewer';

/** Pointer travel (CSS px) that turns a click into a drag. */
const DRAG_THRESHOLD = 3;
/** Distance (CSS px) within which a handle takes a press. */
const HANDLE_REACH = 6;
/** How far beyond a corner (CSS px) a press rotates instead. */
const ROTATE_RING = 18;
/** Distance (CSS px) within which an anchor or handle takes a press. */
const POINT_REACH = 6;
/** Distance (CSS px) from the first point within which the pen closes. */
export const PEN_CLOSE = 8;
/** Pen drags shorter than this (CSS px) place a corner. */
const PEN_DRAG = 3;
/** Shapes drawn with a click (no drag) are this big (points). */
const CLICK_SIZE = 100;

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

/** A curved arrow, the rotate cursor. */
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6 15a7 7 0 1 1 3 4" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M6 15a7 7 0 1 1 3 4" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round"/><path d="M3 12l3 4 3-4z" fill="black" stroke="white" stroke-width="0.8"/></svg>'
)}") 12 12, auto`;

type Pressed = { id: number; wasSelected: boolean } | undefined;
type Mover = ReturnType<AiEditor['startMove']>;
type Transformer = ReturnType<AiEditor['startTransform']>;
type PathEditor = ReturnType<AiEditor['startPathEdit']>;
type ArtboardMover = ReturnType<AiEditor['startArtboard']>;

/** The path being edited with direct selection, at the drag's start. */
interface PointEdit {
  id: number;
  path: PathData;
  transform: Matrix;
  /** Canvas to the path's own space. */
  inverse: Matrix;
  anchor: Anchor;
  start: Point;
  editor: PathEditor;
}

type Press = {
  kind: 'press';
  start: Point;
  current: Point;
  active: boolean;
  deep: boolean;
  additive: boolean;
  pressed: Promise<Pressed>;
  resolved?: { value: Pressed };
  mover?: Mover;
  marquee: boolean;
};

type Drag =
  | { kind: 'pan'; last: Point }
  | { kind: 'pinch'; distance: number; center: Point }
  | Press
  | { kind: 'zoom'; start: Point; current: Point; out: boolean }
  | { kind: 'create'; tool: ShapeTool; start: Point; current: Point }
  | { kind: 'scale'; handle: Handle; start: Rect; mover: Transformer }
  | { kind: 'rotate'; center: Point; from: Point; mover: Transformer }
  | { kind: 'pen'; anchor: Point }
  | ({ kind: 'anchor' } & PointEdit)
  | ({ kind: 'handle'; side: 'in' | 'out' } & PointEdit)
  | {
      kind: 'type';
      start: Point;
      current: Point;
      /** The object under the press, being looked up. */
      under: Promise<number | null>;
    }
  | { kind: 'artboard-new'; start: Point; current: Point }
  | {
      kind: 'artboard-move';
      start: Point;
      rect: Rect;
      mover: ArtboardMover;
      moved: boolean;
    }
  | {
      kind: 'artboard-resize';
      handle: Handle;
      rect: Rect;
      mover: ArtboardMover;
    };

type PointHit =
  | { kind: 'anchor'; index: number }
  | { kind: 'handle'; index: number; side: 'in' | 'out' };

/** A `Matrix` without its translation. */
const linear = (m: Matrix): Matrix => [m[0], m[1], m[2], m[3], 0, 0];

const round2 = (v: number) => Math.round(v * 100) / 100;

const travelled = (a: Point, b: Point) =>
  Math.hypot(b.x - a.x, b.y - a.y) > DRAG_THRESHOLD;

export interface CanvasGestureOptions {
  viewer: AiViewer;
  editor: AiEditor;
  /** The canvas element (pointer coordinates are relative to it). */
  host: () => HTMLElement;
  /** Space is held (a temporary hand tool). */
  spaceHeld: () => boolean;
  /** ⌥/Alt is held (the zoom tool zooms out). */
  altHeld: () => boolean;
  /** Draws the canvas UI again. */
  requestDraw: () => void;
  /** Start typing into a text object (at a character, when known). */
  onEditText: (id: number, at?: Point) => void;
  /** The pointer in canvas coordinates (`null` when it leaves). */
  onPointer?: (canvas: Point | null) => void;
}

export function createCanvasGestures(options: CanvasGestureOptions) {
  const { viewer, editor, requestDraw } = options;

  let drag: Drag | undefined;
  const pointers = new Map<number, Point>();
  let marquee: Rect | undefined;
  let preview: PathData | undefined;
  /** Where the pointer is (canvas) while the pen draws. */
  let penCursor: Point | undefined;
  /** The anchor chosen with direct selection (index into its anchors). */
  let chosenAnchor: number | undefined;
  createEffect(on(viewer.selected, () => (chosenAnchor = undefined)));

  const editing = () => editor.enabled();
  const panning = () => viewer.tool() === 'hand' || options.spaceHeld();
  const zoom = () => viewer.camera().zoom;
  const at = (p: Point) => screenToPage(viewer.camera(), p);
  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = options.host().getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // ---- what the overlay shows ----------------------------------------------

  /** The one path direct selection edits, with its anchors (canvas). */
  const editedPath = () => {
    if (viewer.tool() !== 'direct') return undefined;
    const infos = viewer.infos();
    const info = infos.length === 1 ? infos[0] : undefined;
    if (!info || info.kind !== 'path' || !info.path) return undefined;
    return { info, anchors: canvasAnchors(info.path, info.transform) };
  };

  /** Whether the selection can be scaled and rotated directly. */
  const transformable = () =>
    editing() &&
    viewer.tool() === 'select' &&
    viewer.infos().length > 0 &&
    viewer.infos().every((i) => !i.locked);

  /** The pen's path so far, to where the pointer is. */
  const penOverlay = () => {
    const points = editor.penPoints();
    if (!points || points.length === 0) return undefined;
    const cursor = drag?.kind === 'pen' ? undefined : penCursor;
    const shown = cursor ? [...points, { p: cursor, out: null }] : points;
    return {
      path: penPath(shown, false),
      points: points.map((p) => p.p),
      closing: !!cursor && closesPen(points, cursor, PEN_CLOSE / zoom()),
    };
  };

  // ---- hovering --------------------------------------------------------------

  let hoverPending = false;
  let hoverNext: Point | undefined;
  const hoverAt = (p: Point | undefined) => {
    hoverNext = p;
    if (hoverPending) return;
    hoverPending = true;
    const target = hoverNext;
    const run = async () => {
      try {
        await viewer.hoverAt(target, viewer.tool() === 'direct');
      } finally {
        hoverPending = false;
        if (hoverNext !== target) hoverAt(hoverNext);
      }
    };
    void run();
  };

  /** The selection's box on screen. */
  const screenBox = (): Rect | undefined => {
    const b = viewer.selectionBounds();
    if (!b) return undefined;
    const tl = pageToScreen(viewer.camera(), b);
    return { x: tl.x, y: tl.y, w: b.w * zoom(), h: b.h * zoom() };
  };

  const artboardScreenRect = (id: number | undefined): Rect | undefined => {
    const a = viewer.artboards().find((x) => x.id === id);
    if (!a) return undefined;
    const r = toRect(a.rect);
    const tl = pageToScreen(viewer.camera(), r);
    return { x: tl.x, y: tl.y, w: r.w * zoom(), h: r.h * zoom() };
  };

  /** The point or handle of the edited path under a screen point. */
  const pointAt = (p: Point): PointHit | undefined => {
    const edited = editedPath();
    if (!edited || !editing()) return undefined;
    const camera = viewer.camera();
    const near = (q: Point) => {
      const s = pageToScreen(camera, q);
      return Math.hypot(s.x - p.x, s.y - p.y) <= POINT_REACH;
    };
    const chosen =
      chosenAnchor === undefined ? undefined : edited.anchors[chosenAnchor];
    if (chosen && chosenAnchor !== undefined) {
      if (chosen.handleIn && near(chosen.handleIn))
        return { kind: 'handle', index: chosenAnchor, side: 'in' };
      if (chosen.handleOut && near(chosen.handleOut))
        return { kind: 'handle', index: chosenAnchor, side: 'out' };
    }
    const index = edited.anchors.findIndex((a) => near(a.point));
    return index >= 0 ? { kind: 'anchor', index } : undefined;
  };

  /** The cursor the tool shows over a point, if not its own. */
  const hoverCursor = (p: Point): string | undefined => {
    const tool = viewer.tool();
    if (tool === 'artboard') {
      const chosen = artboardScreenRect(viewer.artboard());
      const handle = chosen && handleAt(chosen, p, HANDLE_REACH);
      return handle ? HANDLE_CURSORS[handle] : undefined;
    }
    if (tool !== 'select' && tool !== 'direct') return undefined;
    const box = screenBox();
    if (box && transformable()) {
      const handle = handleAt(box, p, HANDLE_REACH);
      if (handle) return HANDLE_CURSORS[handle];
      if (rotatesAt(box, p, HANDLE_REACH, ROTATE_RING)) return ROTATE_CURSOR;
    }
    return pointAt(p) ? 'pointer' : undefined;
  };

  let cursorOverride: string | undefined;

  /** The canvas's cursor now. */
  const cursor = () => {
    if (drag?.kind === 'pan') return 'grabbing';
    if (panning()) return 'grab';
    const tool = viewer.tool();
    if (tool === 'zoom') return options.altHeld() ? 'zoom-out' : 'zoom-in';
    if (!editing()) return cursorOverride ?? 'default';
    if (tool === 'type') return 'text';
    if (tool === 'pen' || tool === 'eyedropper' || isShapeTool(tool))
      return 'crosshair';
    return cursorOverride ?? 'default';
  };

  const showCursor = () => {
    options.host().style.cursor = cursor();
  };

  // ---- presses -----------------------------------------------------------------

  const startPointEdit = (p: Point, hit: PointHit) => {
    const edited = editedPath();
    const path = edited?.info.path;
    if (!edited || !path) return;
    const inverse = invert(edited.info.transform);
    if (!inverse) return;
    const anchor = anchorsOf(path)[hit.index];
    if (!anchor) return;
    chosenAnchor = hit.index;
    const common = {
      id: edited.info.id,
      path,
      transform: edited.info.transform,
      inverse,
      anchor,
      start: at(p),
      editor: editor.startPathEdit(edited.info.id),
    };
    drag =
      hit.kind === 'handle'
        ? { kind: 'handle', side: hit.side, ...common }
        : { kind: 'anchor', ...common };
    requestDraw();
  };

  /** A press on the selection's box: scaling or rotating it. */
  const pressBox = (p: Point): boolean => {
    const box = screenBox();
    const start = viewer.selectionBounds();
    if (!transformable() || !box || !start) return false;
    const handle = handleAt(box, p, HANDLE_REACH);
    if (handle) {
      const mover = editor.startTransform(viewer.selected());
      drag = { kind: 'scale', handle, start, mover };
      return true;
    }
    if (!rotatesAt(box, p, HANDLE_REACH, ROTATE_RING)) return false;
    const mover = editor.startTransform(viewer.selected());
    drag = { kind: 'rotate', center: center(start), from: at(p), mover };
    return true;
  };

  /** Presses with the selection tools: the box's handles, points, objects. */
  const pressSelect = (e: PointerEvent, p: Point) => {
    if (pressBox(p)) return;
    const point = pointAt(p);
    if (point) {
      startPointEdit(p, point);
      return;
    }
    const deep = viewer.tool() === 'direct';
    const additive = e.shiftKey;
    const pressed = viewer.pressAt(p, { deep, additive });
    const press: Press = {
      kind: 'press',
      start: p,
      current: p,
      active: false,
      deep,
      additive,
      pressed,
      marquee: false,
    };
    drag = press;
    void (async () => {
      press.resolved = { value: await pressed };
    })();
  };

  /** A press on the chosen artboard's handles: resizing it. */
  const pressArtboardHandle = (p: Point): boolean => {
    const id = viewer.artboard();
    const chosen = artboardScreenRect(id);
    if (!chosen || id === undefined) return false;
    const handle = handleAt(chosen, p, HANDLE_REACH);
    const a = viewer.artboards().find((x) => x.id === id);
    if (!handle || !a) return false;
    const mover = editor.startArtboard(id, []);
    drag = { kind: 'artboard-resize', handle, rect: toRect(a.rect), mover };
    return true;
  };

  /** Presses with the artboard tool: handles, artboards, or new ones. */
  const pressArtboard = async (p: Point) => {
    if (pressArtboardHandle(p)) return;
    const point = at(p);
    const under = [...viewer.artboards()]
      .reverse()
      .find((a) => contains(toRect(a.rect), point));
    if (!under) {
      viewer.setArtboard(undefined);
      drag = { kind: 'artboard-new', start: p, current: p };
      return;
    }
    viewer.setArtboard(under.id);
    // Artwork on the artboard moves with it, as in Illustrator.
    const rect = toRect(under.rect);
    const placeholder: Extract<Drag, { kind: 'artboard-move' }> = {
      kind: 'artboard-move',
      start: point,
      rect,
      mover: editor.startArtboard(under.id, []),
      moved: false,
    };
    drag = placeholder;
    const artwork = await viewer.engine.inRect(
      { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h },
      false
    );
    if (drag === placeholder && !placeholder.moved)
      placeholder.mover = editor.startArtboard(under.id, artwork);
  };

  /** Presses with the pen: a point, or the first one again to close. */
  const pressPen = (p: Point) => {
    const point = at(p);
    const points = editor.penPoints() ?? [];
    const reach = PEN_CLOSE / zoom();
    if (closesPen(points, point, reach)) {
      penCursor = undefined;
      void editor.penFinish(true);
      return;
    }
    const last = points[points.length - 1];
    if (last && Math.hypot(last.p.x - point.x, last.p.y - point.y) <= reach) {
      // The last point again (a double-click) ends an open path.
      penCursor = undefined;
      void editor.penFinish(false);
      return;
    }
    const anchor = { x: round2(point.x), y: round2(point.y) };
    editor.penAdd({ p: anchor, out: null });
    drag = { kind: 'pen', anchor };
  };

  /**
   * Presses with the type tool: into text, or where new text starts
   * (decided on release, so a quick click is not lost to the lookup).
   */
  const pressType = (p: Point) => {
    drag = { kind: 'type', start: p, current: p, under: viewer.hitAt(p, true) };
  };

  /** The eyedropper: what is under the pointer lends its fill and stroke. */
  const pressEyedropper = async (p: Point) => {
    const id = await viewer.hitAt(p, true);
    if (id === null) return;
    const info = await viewer.engine.info(id);
    if (info) await editor.sampleAppearance(info);
  };

  /** A press with a drawing tool. */
  const pressTool = (p: Point) => {
    const tool = viewer.tool();
    if (tool === 'pen') pressPen(p);
    else if (isShapeTool(tool))
      drag = { kind: 'create', tool, start: p, current: p };
    else if (tool === 'type') pressType(p);
    else if (tool === 'eyedropper') void pressEyedropper(p);
    else if (tool === 'artboard') void pressArtboard(p);
  };

  const onPointerDown = (e: PointerEvent) => {
    const host = options.host();
    host.focus({ preventScroll: true });
    const p = local(e);
    pointers.set(e.pointerId, p);
    host.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = {
        kind: 'pinch',
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      return;
    }
    if (e.button === 1 || panning() || e.pointerType === 'touch') {
      e.preventDefault();
      drag = { kind: 'pan', last: p };
      showCursor();
      return;
    }
    if (e.button !== 0) return;
    const tool = viewer.tool();
    if (tool === 'zoom') {
      drag = { kind: 'zoom', start: p, current: p, out: e.altKey };
      return;
    }
    if (!editing() || tool === 'select' || tool === 'direct') {
      pressSelect(e, p);
      return;
    }
    pressTool(p);
  };

  // ---- drags -----------------------------------------------------------------

  const movePress = (press: Press, p: Point, constrain: boolean) => {
    if (!press.mover) return;
    const delta = constrainAngle(
      { x: 0, y: 0 },
      { x: (p.x - press.start.x) / zoom(), y: (p.y - press.start.y) / zoom() },
      constrain
    );
    press.mover.to({ x: round2(delta.x), y: round2(delta.y) });
  };

  /** Starts moving the selection (⌥: a copy of it, left in place). */
  const beginMove = async (press: Press, copy: boolean) => {
    if (copy) {
      const result = await editor.apply([
        { op: 'duplicate', ids: viewer.selected(), offset: [0, 0] },
      ]);
      if (result) viewer.selectCreated(result.created);
    }
    const ids = viewer.selected();
    if (ids.length === 0) return;
    press.mover = editor.startMove(ids);
    movePress(press, press.current, false);
  };

  /** A press that moved: it drags its object, or draws a marquee. */
  const dragPress = (d: Press, p: Point, e: PointerEvent) => {
    d.current = p;
    if (!d.active && travelled(d.start, p)) {
      d.active = true;
      const decide = (r: Pressed) => {
        // A press on an object drags it (when editable); elsewhere it
        // draws a marquee.
        if (r && editing() && !d.additive) void beginMove(d, e.altKey);
        else d.marquee = true;
      };
      if (d.resolved) decide(d.resolved.value);
      else
        void (async () => {
          decide(await d.pressed);
        })();
    }
    if (d.marquee) {
      marquee = spanRect(d.start, p);
      requestDraw();
    } else movePress(d, p, e.shiftKey);
  };

  /** The outline a shape drag would make (canvas coordinates). */
  const shapePreview = (
    tool: ShapeTool,
    a: Point,
    b: Point,
    e: PointerEvent
  ): PathData => {
    const start = at(a);
    if (tool === 'line') {
      const end = constrainAngle(start, at(b), e.shiftKey);
      return {
        segs: [
          { type: 'move', p: start },
          { type: 'line', p: end },
        ],
      };
    }
    const r = shapeRect(start, at(b), {
      square: e.shiftKey,
      fromCenter: e.altKey,
    });
    if (tool === 'rectangle') return rectPath(r);
    if (tool === 'ellipse') return ellipsePath(r);
    return polygonPath(
      r,
      tool === 'star' ? STAR_POINTS : POLYGON_SIDES,
      tool === 'star' ? STAR_INNER : null
    );
  };

  const movePointEdit = (
    d: Extract<Drag, { kind: 'anchor' | 'handle' }>,
    p: Point,
    e: PointerEvent
  ) => {
    const point = at(p);
    if (d.kind === 'anchor') {
      const delta = apply(linear(d.inverse), {
        x: point.x - d.start.x,
        y: point.y - d.start.y,
      });
      d.editor.to(moveAnchor(d.path, d.anchor, delta));
    } else {
      d.editor.to(
        moveHandle(d.path, d.anchor, d.side, apply(d.inverse, point), e.altKey)
      );
    }
  };

  const pinch = (d: Extract<Drag, { kind: 'pinch' }>) => {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    viewer.pan(mid.x - d.center.x, mid.y - d.center.y);
    if (d.distance > 0) viewer.zoomBy(distance / d.distance, mid);
    drag = { kind: 'pinch', distance, center: mid };
  };

  const moveArtboard = (
    d: Extract<Drag, { kind: 'artboard-move' }>,
    p: Point
  ) => {
    const point = at(p);
    const dx = round2(point.x - d.start.x);
    const dy = round2(point.y - d.start.y);
    d.moved = true;
    d.mover.to({
      rect: { ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy },
      dx,
      dy,
    });
  };

  const resizeArtboard = (
    d: Extract<Drag, { kind: 'artboard-resize' }>,
    p: Point,
    e: PointerEvent
  ) => {
    const box = resizeBox(d.rect, d.handle, at(p), {
      keepRatio: e.shiftKey,
      fromCenter: e.altKey,
    });
    const rect = {
      x: round2(box.x),
      y: round2(box.y),
      w: Math.max(1, round2(box.w)),
      h: Math.max(1, round2(box.h)),
    };
    d.mover.to({ rect, dx: 0, dy: 0 });
  };

  /** Carries a drag on to `p`. */
  const moveDrag = (d: Drag, p: Point, e: PointerEvent) =>
    match(d)
      .with({ kind: 'pinch' }, pinch)
      .with({ kind: 'pan' }, (pan) => {
        viewer.pan(p.x - pan.last.x, p.y - pan.last.y);
        drag = { kind: 'pan', last: p };
      })
      .with({ kind: P.union('zoom', 'type', 'artboard-new') }, (area) => {
        area.current = p;
        marquee = spanRect(area.start, p);
        requestDraw();
      })
      .with({ kind: 'create' }, (create) => {
        create.current = p;
        preview = shapePreview(create.tool, create.start, p, e);
        requestDraw();
      })
      .with({ kind: 'pen' }, (pen) => {
        editor.penHandle(penHandle(pen.anchor, at(p), PEN_DRAG / zoom()));
        requestDraw();
      })
      .with({ kind: 'scale' }, (scale) =>
        scale.mover.to(
          resizeMatrix(scale.start, scale.handle, at(p), {
            keepRatio: e.shiftKey,
            fromCenter: e.altKey,
          })
        )
      )
      .with({ kind: 'rotate' }, (rotate) =>
        rotate.mover.to(
          rotateAbout(
            dragAngle(rotate.center, rotate.from, at(p), e.shiftKey),
            rotate.center
          )
        )
      )
      .with({ kind: P.union('anchor', 'handle') }, (edit) =>
        movePointEdit(edit, p, e)
      )
      .with({ kind: 'artboard-move' }, (a) => moveArtboard(a, p))
      .with({ kind: 'artboard-resize' }, (a) => resizeArtboard(a, p, e))
      .with({ kind: 'press' }, (press) => dragPress(press, p, e))
      .exhaustive();

  /** Pointer moves without a press: hover, and the pen's rubber band. */
  const hover = (e: PointerEvent, p: Point) => {
    if (editing() && viewer.tool() === 'pen' && editor.penPoints()) {
      penCursor = at(p);
      requestDraw();
      return;
    }
    if (e.pointerType === 'touch' || panning()) return;
    cursorOverride = hoverCursor(p);
    showCursor();
    if (viewer.tool() === 'select' || viewer.tool() === 'direct') hoverAt(p);
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (e.pointerType !== 'touch') options.onPointer?.(at(p));
    if (drag) moveDrag(drag, p, e);
    else hover(e, p);
  };

  // ---- releases ----------------------------------------------------------------

  /** Ends a shape drag: the shape, or a default-sized one for a click. */
  const finishCreate = async (
    d: Extract<Drag, { kind: 'create' }>,
    e: PointerEvent
  ) => {
    const moved = travelled(d.start, d.current);
    const start = at(d.start);
    if (d.tool === 'line') {
      const end = moved
        ? constrainAngle(start, at(d.current), e.shiftKey)
        : { x: start.x + CLICK_SIZE, y: start.y };
      await editor.createLine(start, end);
      return;
    }
    const rect = moved
      ? shapeRect(start, at(d.current), {
          square: e.shiftKey,
          fromCenter: e.altKey,
        })
      : { x: start.x, y: start.y, w: CLICK_SIZE, h: CLICK_SIZE };
    await editor.createShape(d.tool, {
      x: round2(rect.x),
      y: round2(rect.y),
      w: round2(rect.w),
      h: round2(rect.h),
    });
  };

  /**
   * Ends a type press: a click into text types there; elsewhere point text
   * starts at a click, area text over a drag.
   */
  const finishType = async (d: Extract<Drag, { kind: 'type' }>) => {
    const start = at(d.start);
    const dragged = travelled(d.start, d.current);
    if (!dragged) {
      const under = await d.under;
      const info = under === null ? null : await viewer.engine.info(under);
      if (info?.kind === 'text') {
        viewer.select([info.id]);
        options.onEditText(info.id, start);
        return;
      }
    }
    let id: number | undefined;
    if (dragged) {
      const r = spanRect(start, at(d.current));
      // The first baseline sits an ascent below the area's top.
      id = await editor.createText(
        { x: round2(r.x), y: round2(r.y + 0.9 * TEXT_DEFAULTS.size) },
        round2(Math.max(r.w, 10))
      );
    } else {
      id = await editor.createText(
        { x: round2(start.x), y: round2(start.y) },
        null
      );
    }
    if (id !== undefined) options.onEditText(id);
  };

  /** Ends a zoom-tool press: in (⌥: out) at a click, or to a dragged area. */
  const finishZoom = (d: Extract<Drag, { kind: 'zoom' }>) => {
    const r = spanRect(d.start, d.current);
    if (r.w > DRAG_THRESHOLD && r.h > DRAG_THRESHOLD && !d.out) {
      const tl = at({ x: r.x, y: r.y });
      viewer.zoomToRect({ x: tl.x, y: tl.y, w: r.w / zoom(), h: r.h / zoom() });
      return;
    }
    viewer.zoomStep(d.out || options.altHeld() ? -1 : 1, d.start);
  };

  /** Ends an artboard-tool drag over empty canvas: a new artboard. */
  const finishArtboard = (area: Rect | undefined) => {
    if (!area || area.w <= DRAG_THRESHOLD || area.h <= DRAG_THRESHOLD) return;
    const tl = at({ x: area.x, y: area.y });
    void editor.newArtboard({
      x: round2(tl.x),
      y: round2(tl.y),
      w: round2(area.w / zoom()),
      h: round2(area.h / zoom()),
    });
  };

  const finishMarquee = (d: Press, area: Rect, e: PointerEvent) => {
    const tl = at({ x: area.x, y: area.y });
    void viewer.marqueeSelect(
      { x: tl.x, y: tl.y, w: area.w / zoom(), h: area.h / zoom() },
      { deep: d.deep, additive: e.shiftKey }
    );
  };

  const finishPress = (d: Press, area: Rect | undefined, e: PointerEvent) => {
    if (d.mover) {
      void d.mover.end();
      return;
    }
    if (d.marquee) {
      if (area) finishMarquee(d, area, e);
      return;
    }
    if (d.active) return;
    // A click on one object of a multi-selection selects just it.
    void (async () => {
      const r = await d.pressed;
      if (r?.wasSelected && !d.additive && viewer.selected().length > 1)
        viewer.select([r.id]);
    })();
  };

  /** Ends a drag; `area` is the marquee it drew. */
  const finishDrag = (d: Drag, area: Rect | undefined, e: PointerEvent) =>
    match(d)
      .with({ kind: 'create' }, (create) => void finishCreate(create, e))
      .with({ kind: 'type' }, (type) => void finishType(type))
      .with({ kind: 'zoom' }, finishZoom)
      .with({ kind: 'artboard-new' }, () => finishArtboard(area))
      .with(
        {
          kind: P.union('scale', 'rotate', 'artboard-move', 'artboard-resize'),
        },
        (moved) => void moved.mover.end()
      )
      .with(
        { kind: P.union('anchor', 'handle') },
        (edit) => void edit.editor.end()
      )
      .with({ kind: 'press' }, (press) => finishPress(press, area, e))
      .with({ kind: P.union('pan', 'pinch', 'pen') }, () => undefined)
      .exhaustive();

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    const ended = drag;
    if (pointers.size > 0 && ended?.kind === 'pinch') {
      drag = { kind: 'pan', last: [...pointers.values()][0] };
      return;
    }
    drag = undefined;
    const area = marquee;
    marquee = undefined;
    preview = undefined;
    requestDraw();
    showCursor();
    if (ended) finishDrag(ended, area, e);
  };

  const onPointerLeave = () => {
    if (!drag) {
      hoverAt(undefined);
      penCursor = undefined;
      requestDraw();
    }
    options.onPointer?.(null);
  };

  const onDoubleClick = async (e: MouseEvent) => {
    const tool = viewer.tool();
    if (tool !== 'select' && tool !== 'direct') return;
    const p = local(e);
    // Into a group: the object itself, as direct selection would.
    const id = await viewer.hitAt(p, true);
    if (id === null) return;
    const info = await viewer.engine.info(id);
    if (!info) return;
    viewer.select([id]);
    if (info.kind === 'text' && editing()) options.onEditText(id, at(p));
  };

  return {
    local,
    at,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onDoubleClick,
    cursor,
    showCursor,
    /** Whether a press is under way. */
    dragging: () => drag !== undefined,
    marquee: () => marquee,
    preview: () => preview,
    pen: penOverlay,
    chosenAnchor: () => chosenAnchor,
    editedPath,
    transformable,
  };
}

export type CanvasGestures = ReturnType<typeof createCanvasGestures>;
