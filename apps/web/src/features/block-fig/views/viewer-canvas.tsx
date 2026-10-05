/**
 * The canvas: rendered tiles underneath, the canvas UI on top, and Figma's
 * pointer gestures (scroll to pan, ⌘/Ctrl+scroll or pinch to zoom, Space or
 * middle-drag to pan, click and marquee to select). When the file is
 * editable: drag to move (⌥ to copy, ⇧ to constrain), the selection's
 * handles to resize, and the shape tools to draw.
 */

import { IS_MAC } from '@core/constant/isMac';
import type { FigEngine } from '@core/fig-engine/client';
import type { LayerRow, NodeInfo, Rect } from '@core/fig-engine/types';
import {
  createEffect,
  createMemo,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { drawOverlay, type OverlayModel } from '../components/overlay';
import { PeerCursors } from '../components/peer-presence';
import { type Point, screenToPage } from '../core/camera';
import { measure } from '../core/measure';
import type { PeerOverlay } from '../core/presence';
import { rotationFor } from '../core/rotation';
import { type Guide, snapMove } from '../core/snap';
import type { FigEditor, ShapeTool } from '../primitives/create-fig-editor';
import type { FigViewer } from '../primitives/create-fig-viewer';
import { createTileCompositor } from '../primitives/create-tile-compositor';

/** Pointer travel (CSS px) that turns a click into a drag. */
const DRAG_THRESHOLD = 3;

function cssColor(rgba: [number, number, number, number]) {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${c(rgba[0])}, ${c(rgba[1])}, ${c(rgba[2])})`;
}

function luminance(rgba: [number, number, number, number]) {
  return 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

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

/** Distance (CSS px) within which a handle (or edge) takes a press. */
const HANDLE_SLOP = 6;

/** How far beyond a corner (CSS px) a press rotates instead. */
const ROTATE_REACH = 18;

/** A curved arrow, the rotate cursor. */
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6 15a7 7 0 1 1 3 4" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M6 15a7 7 0 1 1 3 4" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round"/><path d="M3 12l3 4 3-4z" fill="black" stroke="white" stroke-width="0.8"/></svg>'
)}") 12 12, auto`;

type Pressed = { row: LayerRow; wasSelected: boolean } | undefined;

type Drag =
  | { kind: 'pan'; last: Point }
  | {
      kind: 'press';
      start: Point;
      current: Point;
      active: boolean;
      /** The pressed layer, once the hit test answers. */
      pressed: Promise<Pressed>;
      resolved?: Pressed;
      mover?: ReturnType<FigEditor['startMove']>;
      /** The selection's bounds at the start, and what it snaps to. */
      snap?: { start: Rect; targets: Rect[] };
      marquee: boolean;
      additive: boolean;
    }
  | { kind: 'create'; tool: ShapeTool; start: Point; current: Point }
  | {
      kind: 'resize';
      handle: Handle;
      start: Rect;
      resizer: ReturnType<FigEditor['startResize']>;
    }
  | {
      kind: 'rotate';
      /** Page point the layer turns about. */
      center: Point;
      startAngle: number;
      startRotation: number;
      rotator: ReturnType<FigEditor['startRotate']>;
    }
  | {
      kind: 'pinch';
      distance: number;
      center: Point;
    };

const isShapeTool = (tool: string): tool is ShapeTool =>
  tool === 'frame' ||
  tool === 'rectangle' ||
  tool === 'ellipse' ||
  tool === 'line' ||
  tool === 'arrow' ||
  tool === 'text';

const isLineTool = (tool: string) => tool === 'line' || tool === 'arrow';

/** The end of a line drawn to `p`; ⇧ snaps it to 45° steps. */
export function lineEnd(start: Point, p: Point, snap: boolean): Point {
  if (!snap) return p;
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = Math.hypot(dx, dy);
  return {
    x: start.x + Math.cos(angle) * len,
    y: start.y + Math.sin(angle) * len,
  };
}

/** New bounds for dragging `handle` of `start` to page point `p`. */
export function resizeRect(
  start: Rect,
  handle: Handle,
  p: Point,
  keepAspect: boolean
): Rect {
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  if (handle.includes('w')) x0 = Math.min(p.x, x1 - 1);
  if (handle.includes('e')) x1 = Math.max(p.x, x0 + 1);
  if (handle.includes('n')) y0 = Math.min(p.y, y1 - 1);
  if (handle.includes('s')) y1 = Math.max(p.y, y0 + 1);
  if (keepAspect && start.w > 0 && start.h > 0 && handle.length === 2) {
    const ratio = start.w / start.h;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w / h > ratio) {
      const nh = w / ratio;
      if (handle.includes('n')) y0 = y1 - nh;
      else y1 = y0 + nh;
    } else {
      const nw = h * ratio;
      if (handle.includes('w')) x0 = x1 - nw;
      else x1 = x0 + nw;
    }
  }
  const r = (v: number) => Math.round(v);
  return { x: r(x0), y: r(y0), w: r(x1) - r(x0), h: r(y1) - r(y0) };
}

export function ViewerCanvas(props: {
  viewer: FigViewer;
  engine: FigEngine;
  /** Space is held (temporary hand tool). */
  spaceHeld: () => boolean;
  /** ⌥/Alt is held (measure to the hovered layer). */
  altHeld: () => boolean;
  /** ⌘/Ctrl is held (deep select). */
  deepHeld: () => boolean;
  /** Editing, when the file is editable. */
  editor?: FigEditor;
  /** The single selected layer's properties (for resizing). */
  info?: () => NodeInfo | undefined;
  /** Start typing into a text layer. */
  onEditText?: (id: string) => void;
  /** Called by the canvas with its invalidation hook. */
  onInvalidator?: (invalidate: (rect: Rect) => void) => void;
  /** Other people on the page, when the design is shared. */
  peers?: () => PeerOverlay[];
  /** The pointer in page coordinates (`null` when it leaves the canvas). */
  onPointer?: (page: Point | null) => void;
  children?: JSX.Element;
}) {
  const viewer = props.viewer;
  let host!: HTMLDivElement;
  let tileCanvas!: HTMLCanvasElement;
  let overlayCanvas!: HTMLCanvasElement;
  const [dpr, setDpr] = (() => {
    let value =
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const listeners = new Set<() => void>();
    return [
      () => value,
      (v: number) => {
        value = v;
        for (const l of listeners) l();
      },
    ] as const;
  })();

  let frame: number | undefined;
  const requestDraw = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      draw();
    });
  };

  const compositor = createTileCompositor({
    engine: props.engine,
    onTile: requestDraw,
  });
  props.onInvalidator?.((rect) => {
    compositor.invalidate(rect);
    requestDraw();
  });
  onCleanup(() => {
    compositor.dispose();
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  const background = () =>
    viewer.pages[viewer.page()]?.background ?? [0.96, 0.96, 0.96, 1];

  const view = () => ({
    camera: viewer.camera(),
    viewport: viewer.viewport(),
    dpr: dpr(),
  });

  // The compositor and canvases are external systems synced from state.
  let shownPage: { page: number; outline: boolean } | undefined;
  createEffect(
    on(
      () => [viewer.layout(), viewer.outlineView()] as const,
      ([layout, outline]) => {
        if (!layout) return;
        const page = viewer.page();
        if (shownPage?.page === page && shownPage.outline === outline) {
          // Same page after an edit: keep the tiles, update the bounds.
          compositor.setContent(viewer.contentBounds());
        } else {
          shownPage = { page, outline };
          compositor.setPage({
            page,
            outline,
            content: viewer.contentBounds(),
            background: cssColor(background()),
          });
        }
        requestDraw();
      }
    )
  );
  createEffect(
    on([viewer.camera, viewer.viewport, viewer.layout], () => {
      if (viewer.viewport().w <= 0 || !viewer.layout()) return;
      compositor.update(view());
      requestDraw();
    })
  );

  const hoverPath = createMemo(() => {
    const d = viewer.hoverOutline();
    if (!d || viewer.selected().some((s) => s.id === viewer.hover()?.id))
      return undefined;
    try {
      return new Path2D(d);
    } catch {
      return undefined;
    }
  });

  let marquee: Rect | undefined;
  let linePreview: [Point, Point] | undefined;
  let guides: Guide[] = [];

  /** Bounds of the layers a moving selection can snap to. */
  const snapTargets = async (ids: string[]): Promise<Rect[]> => {
    const page = viewer.page();
    const first = viewer.selected()[0];
    const parent = first?.parent ?? undefined;
    const rows = await props.engine.layers(page, parent);
    const others = rows
      .filter((r) => r.visible && !ids.includes(r.id))
      .map((r) => r.id)
      .slice(0, 400);
    const withParent = parent ? [...others, parent] : others;
    const geometry = await props.engine.geometry(page, withParent);
    return geometry.map((g) => g.bounds);
  };
  const measurements = () => {
    const a = viewer.selectionBounds();
    const b = viewer.hoverBounds();
    if (!props.altHeld() || !a || !b) return [];
    if (viewer.selected().some((s) => s.id === viewer.hover()?.id)) return [];
    return measure(a, b);
  };

  const overlayModel = (): OverlayModel => {
    const hover = viewer.hover();
    const selectionIds = new Set(viewer.selected().map((s) => s.id));
    return {
      camera: viewer.camera(),
      viewport: viewer.viewport(),
      dpr: dpr(),
      frames: viewer.layout()?.frames ?? [],
      selectedIds: selectionIds,
      selection: viewer.selectionGeometry(),
      selectionBounds: viewer.selectionBounds(),
      componentSelection: false,
      hoverPath: hoverPath(),
      hoverComponent:
        !!hover && (hover.type === 'SYMBOL' || hover.type === 'INSTANCE'),
      marquee,
      line: linePreview,
      guides,
      measurements: measurements(),
      rulers: viewer.rulers(),
      pixelGrid: viewer.pixelGrid(),
      darkCanvas: luminance(background()) < 0.35,
      peers: props.peers?.(),
    };
  };

  createEffect(
    on(
      [
        viewer.selectionGeometry,
        hoverPath,
        viewer.rulers,
        viewer.pixelGrid,
        props.altHeld,
        viewer.hoverBounds,
        () => props.peers?.(),
      ],
      requestDraw
    )
  );

  function draw() {
    const v = view();
    if (v.viewport.w <= 0) return;
    const ctx = tileCanvas.getContext('2d', { alpha: false });
    if (ctx) compositor.draw(ctx, v);
    const octx = overlayCanvas.getContext('2d');
    if (octx) drawOverlay(octx, overlayModel());
  }

  // ---- size --------------------------------------------------------------

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      const ratio = window.devicePixelRatio || 1;
      setDpr(ratio);
      for (const canvas of [tileCanvas, overlayCanvas]) {
        canvas.width = Math.max(1, Math.round(r.width * ratio));
        canvas.height = Math.max(1, Math.round(r.height * ratio));
      }
      viewer.resize({ w: r.width, h: r.height });
      requestDraw();
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });

  // ---- pointer -----------------------------------------------------------

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pointers = new Map<number, Point>();
  let drag: Drag | undefined;
  let hoverPending = false;
  let hoverNext: Point | undefined;

  const hoverAt = (p: Point | undefined) => {
    hoverNext = p;
    if (hoverPending) return;
    hoverPending = true;
    const run = () => {
      const target = hoverNext;
      void viewer.hoverAt(target, props.deepHeld()).finally(() => {
        hoverPending = false;
        if (hoverNext !== target) hoverAt(hoverNext);
      });
    };
    run();
  };

  const panning = () => viewer.tool() === 'hand' || props.spaceHeld();
  const editing = () => !!props.editor?.enabled();

  const pageAt = (p: Point) => screenToPage(viewer.camera(), p);

  /** Whether the selection can be resized or rotated directly. */
  const transformable = () => {
    if (!editing()) return false;
    const sel = viewer.selected();
    if (sel.length === 0 || sel.some((s) => s.id.startsWith('I'))) return false;
    if (sel.length > 1) return true;
    const info = props.info?.();
    return !!info && info.id === sel[0].id && !info.locked;
  };

  /** The selection's box on screen. */
  const screenBox = () => {
    const b = viewer.selectionBounds();
    if (!b) return undefined;
    const c = viewer.camera();
    const x0 = (b.x - c.x) * c.zoom;
    const y0 = (b.y - c.y) * c.zoom;
    return { b, x0, y0, x1: x0 + b.w * c.zoom, y1: y0 + b.h * c.zoom };
  };

  /** The resize handle (or edge) of the selection under a point. */
  const handleAt = (p: Point): Handle | undefined => {
    if (!transformable()) return undefined;
    const info = props.info?.();
    if (viewer.selected().length === 1 && Math.abs(info?.rotation ?? 0) > 0.01)
      return undefined;
    const box = screenBox();
    if (!box) return undefined;
    const { b, x0, y0, x1, y1 } = box;
    const c = viewer.camera();
    const near = (a: number, v: number) => Math.abs(a - v) <= HANDLE_SLOP;
    const inX = p.x >= x0 - HANDLE_SLOP && p.x <= x1 + HANDLE_SLOP;
    const inY = p.y >= y0 - HANDLE_SLOP && p.y <= y1 + HANDLE_SLOP;
    const w = near(p.x, x0) && inY;
    const e = near(p.x, x1) && inY;
    const n = near(p.y, y0) && inX;
    const s = near(p.y, y1) && inX;
    if (n && w) return 'nw';
    if (n && e) return 'ne';
    if (s && w) return 'sw';
    if (s && e) return 'se';
    // Edges only when the box is big enough to grab inside it.
    if (b.w * c.zoom < 12 || b.h * c.zoom < 12) return undefined;
    if (n) return 'n';
    if (s) return 's';
    if (w) return 'w';
    if (e) return 'e';
    return undefined;
  };

  /** Whether a point is just beyond a corner of a single selection. */
  const rotateAt = (p: Point): boolean => {
    if (!transformable() || viewer.selected().length !== 1) return false;
    const box = screenBox();
    if (!box) return false;
    const { x0, y0, x1, y1 } = box;
    const outside = p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1;
    if (!outside) return false;
    return [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ].some(([cx, cy]) => {
      const d = Math.hypot(p.x - cx, p.y - cy);
      return d > HANDLE_SLOP && d <= HANDLE_SLOP + ROTATE_REACH;
    });
  };

  const [cursorOverride, setCursorOverride] = (() => {
    let value: string | undefined;
    return [
      () => value,
      (v: string | undefined) => {
        value = v;
        if (host) host.style.cursor = cursor();
      },
    ] as const;
  })();

  const onPointerDown = (e: PointerEvent) => {
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
      return;
    }
    if (e.button !== 0) return;
    const tool = viewer.tool();
    if (editing() && isShapeTool(tool)) {
      drag = { kind: 'create', tool, start: p, current: p };
      return;
    }
    const handle = handleAt(p);
    const info = props.info?.();
    const bounds = viewer.selectionBounds();
    if (handle && bounds && props.editor) {
      drag = {
        kind: 'resize',
        handle,
        start: bounds,
        resizer: props.editor.startResize(
          viewer.selected().map((s) => s.id),
          bounds,
          info
        ),
      };
      return;
    }
    if (rotateAt(p) && info && bounds && props.editor) {
      const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
      const at = pageAt(p);
      drag = {
        kind: 'rotate',
        center,
        startAngle: Math.atan2(at.y - center.y, at.x - center.x),
        startRotation: info.rotation,
        rotator: props.editor.startRotate(info.id),
      };
      return;
    }
    const additive = e.shiftKey;
    const pressed = viewer.pressAt(p, {
      deep: IS_MAC ? e.metaKey : e.ctrlKey,
      additive,
    });
    const press: Extract<Drag, { kind: 'press' }> = {
      kind: 'press',
      start: p,
      current: p,
      active: false,
      pressed,
      marquee: false,
      additive,
    };
    drag = press;
    void pressed.then((r) => {
      press.resolved = r;
    });
  };

  /** Starts moving the selection (⌥: a copy of it). */
  const beginMove = async (
    press: Extract<Drag, { kind: 'press' }>,
    copy: boolean
  ) => {
    const editor = props.editor;
    if (!editor) return;
    if (copy) await editor.duplicateSelection();
    const ids = editor.editableIds();
    if (ids.length === 0) return;
    const start = viewer.selectionBounds();
    press.mover = editor.startMove(ids);
    movePress(press, press.current, false);
    if (start) {
      const targets = await snapTargets(ids).catch(() => []);
      press.snap = { start, targets };
    }
  };

  const movePress = (
    press: Extract<Drag, { kind: 'press' }>,
    p: Point,
    constrain: boolean
  ) => {
    if (!press.mover) return;
    const z = viewer.camera().zoom;
    let dx = (p.x - press.start.x) / z;
    let dy = (p.y - press.start.y) / z;
    if (constrain) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    // Whole pixels, as with Figma's pixel snapping; then smart guides.
    dx = Math.round(dx);
    dy = Math.round(dy);
    if (press.snap) {
      const snapped = snapMove(
        press.snap.start,
        dx,
        dy,
        press.snap.targets,
        5 / z
      );
      dx = constrain && dx === 0 ? 0 : Math.round(snapped.dx);
      dy = constrain && dy === 0 ? 0 : Math.round(snapped.dy);
      guides = snapped.guides;
      requestDraw();
    }
    press.mover.to(dx, dy);
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (e.pointerType !== 'touch') props.onPointer?.(pageAt(p));
    if (!drag) {
      if (e.pointerType !== 'touch' && !panning()) {
        const handle = handleAt(p);
        setCursorOverride(
          handle
            ? HANDLE_CURSORS[handle]
            : rotateAt(p)
              ? ROTATE_CURSOR
              : undefined
        );
        if (!isShapeTool(viewer.tool())) hoverAt(p);
      }
      return;
    }
    if (drag.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      viewer.pan(center.x - drag.center.x, center.y - drag.center.y);
      if (drag.distance > 0) viewer.zoomBy(distance / drag.distance, center);
      drag = { kind: 'pinch', distance, center };
    } else if (drag.kind === 'pan') {
      viewer.pan(p.x - drag.last.x, p.y - drag.last.y);
      drag = { kind: 'pan', last: p };
    } else if (drag.kind === 'create') {
      drag.current = p;
      if (isLineTool(drag.tool))
        linePreview = [drag.start, lineEnd(drag.start, p, e.shiftKey)];
      else marquee = shapeRect(drag.start, p, e.shiftKey);
      requestDraw();
    } else if (drag.kind === 'resize') {
      const rect = resizeRect(drag.start, drag.handle, pageAt(p), e.shiftKey);
      drag.resizer.to(rect);
    } else if (drag.kind === 'rotate') {
      const at = pageAt(p);
      const angle = Math.atan2(at.y - drag.center.y, at.x - drag.center.x);
      drag.rotator.to(
        rotationFor(drag.startRotation, drag.startAngle, angle, e.shiftKey)
      );
    } else if (drag.kind === 'press') {
      const press = drag;
      press.current = p;
      const moved =
        Math.hypot(p.x - press.start.x, p.y - press.start.y) > DRAG_THRESHOLD;
      if (!press.active && moved) {
        press.active = true;
        const decide = (r: Pressed) => {
          // A press on a layer drags it (when editable and unlocked);
          // anywhere else draws a marquee.
          if (r && editing() && !r.row.locked && !press.additive)
            void beginMove(press, e.altKey);
          else press.marquee = true;
        };
        if ('resolved' in press) decide(press.resolved);
        else void press.pressed.then(decide);
      }
      if (press.marquee) {
        marquee = {
          x: Math.min(press.start.x, p.x),
          y: Math.min(press.start.y, p.y),
          w: Math.abs(p.x - press.start.x),
          h: Math.abs(p.y - press.start.y),
        };
        requestDraw();
      } else movePress(press, p, e.shiftKey);
    }
  };

  /** The page rectangle a shape drag covers (⇧: square). */
  const shapeRect = (a: Point, b: Point, square: boolean): Rect => {
    let w = b.x - a.x;
    let h = b.y - a.y;
    if (square) {
      const side = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * side;
      h = Math.sign(h || 1) * side;
    }
    return {
      x: Math.min(a.x, a.x + w),
      y: Math.min(a.y, a.y + h),
      w: Math.abs(w),
      h: Math.abs(h),
    };
  };

  const finishCreate = async (
    d: Extract<Drag, { kind: 'create' }>,
    shift: boolean
  ) => {
    const editor = props.editor;
    if (!editor) return;
    const c = viewer.camera();
    const moved =
      Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y) >
      DRAG_THRESHOLD;
    if (isLineTool(d.tool)) {
      const from = pageAt(d.start);
      // A click draws Figma's default 100 px line.
      const to = moved
        ? pageAt(lineEnd(d.start, d.current, shift))
        : { x: from.x + 100, y: from.y };
      // Back to Move now, so a tool chosen meanwhile is kept.
      viewer.setTool('move');
      const parent = await viewer.containerAt(from);
      await editor.createLine(from, to, d.tool === 'arrow', parent);
      return;
    }
    const screen = shapeRect(d.start, d.current, shift);
    const a = screenToPage(c, { x: screen.x, y: screen.y });
    // A click places Figma's default size (text grows as it is typed).
    const size = d.tool === 'text' ? 1 : 100;
    const rect = moved
      ? { x: a.x, y: a.y, w: screen.w / c.zoom, h: screen.h / c.zoom }
      : { x: a.x, y: a.y, w: size, h: size };
    viewer.setTool('move');
    const parent = await viewer.containerAt(pageAt(d.start));
    const id = await editor.create(d.tool, rect, parent);
    if (id && d.tool === 'text') props.onEditText?.(id);
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    const ended = drag;
    if (pointers.size > 0 && ended?.kind === 'pinch') {
      drag = { kind: 'pan', last: [...pointers.values()][0] };
      return;
    }
    drag = undefined;
    if (!ended) return;
    if (ended.kind === 'create') {
      marquee = undefined;
      linePreview = undefined;
      requestDraw();
      void finishCreate(ended, e.shiftKey);
    } else if (ended.kind === 'resize') {
      void ended.resizer.end();
    } else if (ended.kind === 'rotate') {
      void ended.rotator.end();
    } else if (ended.kind === 'press') {
      if (ended.mover) {
        guides = [];
        requestDraw();
        void ended.mover.end();
      } else if (ended.marquee && marquee) {
        const c = viewer.camera();
        const a = screenToPage(c, { x: marquee.x, y: marquee.y });
        void viewer.marqueeSelect(
          { x: a.x, y: a.y, w: marquee.w / c.zoom, h: marquee.h / c.zoom },
          e.shiftKey
        );
        marquee = undefined;
        requestDraw();
      } else if (!ended.active) {
        // A click on one layer of a multi-selection selects just it.
        void ended.pressed.then((r) => {
          if (r?.wasSelected && !ended.additive && viewer.selected().length > 1)
            void viewer.selectIds([r.row.id]);
        });
      }
    }
  };

  const onDoubleClick = async (e: MouseEvent) => {
    if (panning() || isShapeTool(viewer.tool())) return;
    await viewer.clickAt(local(e), {
      deep: false,
      additive: false,
      double: true,
    });
    const sel = viewer.selected();
    if (editing() && sel.length === 1 && props.info?.()?.id === sel[0].id) {
      // Double-click on a text layer types into it.
      const info = props.info?.();
      if (info?.type === 'TEXT') props.onEditText?.(info.id);
    }
  };

  // Wheel must be non-passive to stop the page (and browser zoom) moving.
  onMount(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinches arrive as ctrl+wheel with small deltas.
        const clamped = Math.max(-60, Math.min(60, dy));
        viewer.zoomBy(Math.exp(-clamped * 0.01), p);
      } else if (e.shiftKey && dx === 0) {
        viewer.pan(-dy, 0);
      } else {
        viewer.pan(-dx, -dy);
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    // Safari's own pinch events (trackpad), with a running scale.
    let gestureScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & {
        scale: number;
        clientX: number;
        clientY: number;
      };
      viewer.zoomBy(g.scale / gestureScale, local(g));
      gestureScale = g.scale;
    };
    host.addEventListener('gesturestart', onGestureStart);
    host.addEventListener('gesturechange', onGestureChange);
    onCleanup(() => {
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('gesturestart', onGestureStart);
      host.removeEventListener('gesturechange', onGestureChange);
    });
  });

  const cursor = () => {
    if (drag?.kind === 'pan') return 'grabbing';
    if (panning()) return 'grab';
    if (editing() && viewer.tool() === 'text') return 'text';
    if (editing() && isShapeTool(viewer.tool())) return 'crosshair';
    return cursorOverride() ?? 'default';
  };

  return (
    <div
      ref={host}
      // Focusable so a press on the canvas takes keys from the layer search;
      // shortcuts bubble to the viewer.
      tabIndex={-1}
      class="relative size-full touch-none select-none overflow-hidden outline-none"
      style={{ cursor: cursor() }}
      data-testid="fig-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (!drag) hoverAt(undefined);
        props.onPointer?.(null);
      }}
      onDblClick={(e) => void onDoubleClick(e)}
      onDragOver={(e) => {
        if (editing() && e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const files = [...(e.dataTransfer?.files ?? [])];
        if (!editing() || files.length === 0) return;
        e.preventDefault();
        const at = pageAt(local(e));
        void viewer
          .containerAt(at)
          .then((parent) => props.editor?.importImages(files, at, parent));
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={tileCanvas} class="absolute inset-0 size-full" />
      <canvas
        ref={overlayCanvas}
        class="pointer-events-none absolute inset-0 size-full"
      />
      <Show when={props.peers}>
        {(peers) => <PeerCursors peers={peers()()} camera={viewer.camera()} />}
      </Show>
      {props.children}
    </div>
  );
}
