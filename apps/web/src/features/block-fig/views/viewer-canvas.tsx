/**
 * The canvas: rendered tiles underneath, the canvas UI on top, and Figma's
 * pointer gestures (scroll to pan, ⌘/Ctrl+scroll or pinch to zoom, Space or
 * middle-drag to pan, click and marquee to select).
 */

import { IS_MAC } from '@core/constant/isMac';
import type { FigEngine } from '@core/fig-engine/client';
import type { Rect } from '@core/fig-engine/types';
import {
  createEffect,
  createMemo,
  type JSX,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import { drawOverlay, type OverlayModel } from '../components/overlay';
import { type Point, screenToPage } from '../core/camera';
import { measure } from '../core/measure';
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

type Drag =
  | { kind: 'pan'; last: Point }
  | { kind: 'select'; start: Point; current: Point; active: boolean }
  | {
      kind: 'pinch';
      distance: number;
      center: Point;
    };

export function ViewerCanvas(props: {
  viewer: FigViewer;
  engine: FigEngine;
  /** Space is held (temporary hand tool). */
  spaceHeld: () => boolean;
  /** ⌥/Alt is held (measure to the hovered layer). */
  altHeld: () => boolean;
  /** ⌘/Ctrl is held (deep select). */
  deepHeld: () => boolean;
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
  // TEMP debug
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
  createEffect(
    on(
      () => [viewer.layout(), viewer.outlineView()] as const,
      ([layout, outline]) => {
        if (!layout) return;
        compositor.setPage({
          page: viewer.page(),
          outline,
          content: viewer.contentBounds(),
          background: cssColor(background()),
        });
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
      measurements: measurements(),
      rulers: viewer.rulers(),
      pixelGrid: viewer.pixelGrid(),
      darkCanvas: luminance(background()) < 0.35,
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
    drag = { kind: 'select', start: p, current: p, active: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (!drag) {
      if (e.pointerType !== 'touch' && !panning()) hoverAt(p);
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
    } else if (drag.kind === 'select') {
      const moved =
        Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > DRAG_THRESHOLD;
      drag = { ...drag, current: p, active: drag.active || moved };
      if (drag.active) {
        marquee = {
          x: Math.min(drag.start.x, p.x),
          y: Math.min(drag.start.y, p.y),
          w: Math.abs(p.x - drag.start.x),
          h: Math.abs(p.y - drag.start.y),
        };
        requestDraw();
      }
    }
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
    if (ended.kind === 'select') {
      if (ended.active && marquee) {
        const c = viewer.camera();
        const a = screenToPage(c, { x: marquee.x, y: marquee.y });
        void viewer.marqueeSelect(
          { x: a.x, y: a.y, w: marquee.w / c.zoom, h: marquee.h / c.zoom },
          e.shiftKey
        );
        marquee = undefined;
        requestDraw();
      } else {
        void viewer.clickAt(ended.start, {
          deep: IS_MAC ? e.metaKey : e.ctrlKey,
          additive: e.shiftKey,
          double: false,
        });
      }
    }
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (panning()) return;
    void viewer.clickAt(local(e), {
      deep: false,
      additive: false,
      double: true,
    });
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
    return 'default';
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
      }}
      onDblClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={tileCanvas} class="absolute inset-0 size-full" />
      <canvas
        ref={overlayCanvas}
        class="pointer-events-none absolute inset-0 size-full"
      />
      {props.children}
    </div>
  );
}
