/**
 * The canvas: composited tiles over a checkerboard underneath, the
 * overlay on top, and Photoshop's view gestures (scroll to pan, ⌘/Ctrl +
 * scroll or pinch to zoom, Space or middle-drag to pan). Presses go to the
 * tool in use (`create-canvas-tools`).
 */

import { type Point, screenToPage } from '@app/features/block-fig/core/camera';
import type { Guide, IRect } from '@core/psd-engine/types';
import { createEffect, type JSX, on, onCleanup, onMount } from 'solid-js';
import { drawOverlay, type PeerSelection } from '../components/overlay';
import { pressureOf } from '../core/brush';
import type { DocSize } from '../core/tiles';
import type {
  CanvasPointer,
  CanvasTools,
} from '../primitives/create-canvas-tools';
import type { PsdEditor } from '../primitives/create-psd-editor';
import type { PsdView } from '../primitives/create-psd-view';
import { createTileCompositor } from '../primitives/create-tile-compositor';

/** Checkerboard squares, in CSS pixels. */
const CHECKER = 8;

function checkerPattern(
  ctx: CanvasRenderingContext2D,
  dpr: number
): CanvasPattern | undefined {
  const side = Math.max(1, Math.round(CHECKER * dpr));
  const tile = document.createElement('canvas');
  tile.width = side * 2;
  tile.height = side * 2;
  const t = tile.getContext('2d');
  if (!t) return undefined;
  // Photoshop's transparency grid: white and light gray, in any theme.
  t.fillStyle = '#ffffff';
  t.fillRect(0, 0, side * 2, side * 2);
  t.fillStyle = '#cccccc';
  t.fillRect(side, 0, side, side);
  t.fillRect(0, side, side, side);
  return ctx.createPattern(tile, 'repeat') ?? undefined;
}

export function PsdCanvas(props: {
  editor: PsdEditor;
  view: PsdView;
  tools: CanvasTools;
  /** Called with the canvas's invalidation hooks. */
  onCompositor: (hooks: {
    invalidate: (rect: IRect) => void;
    reset: (doc: DocSize) => void;
    idle: () => boolean;
  }) => void;
  /** Other people's selections, in their colors. */
  peerSelections?: () => PeerSelection[];
  guides: () => Guide[];
  /** The pointer in canvas pixels (`null` when it leaves the canvas). */
  onPointer?: (at: Point | null) => void;
  /** Image files dropped on the canvas, at a canvas point. */
  onDropFiles?: (files: File[], at: Point) => void;
  children?: JSX.Element;
}) {
  const { editor, view, tools } = props;
  let host!: HTMLDivElement;
  let tileCanvas!: HTMLCanvasElement;
  let overlayCanvas!: HTMLCanvasElement;
  let checker: CanvasPattern | undefined;
  let checkerDpr = 0;
  let antsPhase = 0;

  let frame: number | undefined;
  let frameTimer: ReturnType<typeof setTimeout> | undefined;
  const requestDraw = () => {
    if (frame !== undefined || frameTimer !== undefined) return;
    // Hidden tabs (and automated browsers) run no animation frames.
    if (document.visibilityState !== 'visible') {
      frameTimer = setTimeout(() => {
        frameTimer = undefined;
        draw();
      }, 16);
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = undefined;
      draw();
    });
  };

  const compositor = createTileCompositor({
    engine: editor.engine,
    onTile: requestDraw,
  });
  props.onCompositor({
    invalidate: (rect) => {
      compositor.invalidate(rect);
      requestDraw();
    },
    reset: (doc) => {
      compositor.setDocument(doc);
      requestDraw();
    },
    idle: () => compositor.idle(),
  });
  compositor.setDocument(editor.docSize());
  onCleanup(() => {
    compositor.dispose();
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(frameTimer);
  });

  const compositorView = () => ({
    camera: view.camera(),
    viewport: view.viewport(),
    dpr: view.dpr(),
  });

  function draw() {
    const v = compositorView();
    if (v.viewport.w <= 0) return;
    const ctx = tileCanvas.getContext('2d');
    if (ctx) {
      if (checkerDpr !== v.dpr) {
        checker = checkerPattern(ctx, v.dpr);
        checkerDpr = v.dpr;
      }
      // The checkerboard moves with the document.
      const s = v.camera.zoom * v.dpr;
      checker?.setTransform(
        new DOMMatrix().translateSelf(
          Math.round(-v.camera.x * s),
          Math.round(-v.camera.y * s)
        )
      );
      compositor.draw(ctx, v, checker);
    }
    const octx = overlayCanvas.getContext('2d');
    if (octx)
      drawOverlay(octx, {
        ...v,
        doc: editor.docSize(),
        selection: editor.selection(),
        antsPhase,
        tools: tools.overlay(),
        peers: props.peerSelections?.() ?? [],
        guides: props.guides(),
        pixelGrid: view.pixelGrid(),
        accent: accentColor(),
      });
  }

  let accent: string | undefined;
  const accentColor = () => {
    if (!accent)
      accent =
        getComputedStyle(host).getPropertyValue('--color-accent').trim() ||
        '#1473e6';
    return accent;
  };

  // The compositor and canvases are external systems synced from state.
  createEffect(
    on([view.camera, view.viewport, view.dpr], () => {
      if (view.viewport().w <= 0) return;
      compositor.update(compositorView());
      requestDraw();
    })
  );
  createEffect(
    on(
      [
        editor.selection,
        tools.overlay,
        view.pixelGrid,
        () => props.peerSelections?.(),
        props.guides,
      ],
      requestDraw
    )
  );

  // Marching ants march while there is a selection to show.
  onMount(() => {
    const timer = setInterval(() => {
      const moving =
        editor.selection().outline.length > 0 ||
        !!tools.overlay().marquee ||
        !!tools.overlay().lasso;
      if (!moving) return;
      antsPhase = (antsPhase + 1) % 8;
      requestDraw();
    }, 90);
    onCleanup(() => clearInterval(timer));
  });

  // ---- size ----------------------------------------------------------------

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      const ratio = window.devicePixelRatio || 1;
      view.setDpr(ratio);
      const width = Math.max(1, Math.round(r.width * ratio));
      const height = Math.max(1, Math.round(r.height * ratio));
      view.resize({ w: r.width, h: r.height });
      if (tileCanvas.width === width && tileCanvas.height === height) {
        requestDraw();
        return;
      }
      for (const canvas of [tileCanvas, overlayCanvas]) {
        canvas.width = width;
        canvas.height = height;
      }
      // Sizing clears a canvas: draw before this frame is painted.
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
      draw();
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });

  // ---- pointer -----------------------------------------------------------------

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pointerOf = (e: PointerEvent): CanvasPointer => {
    const screen = local(e);
    const camera = view.camera();
    const mod = e.metaKey || e.ctrlKey;
    const coalesced =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    return {
      screen,
      at: screenToPage(camera, screen),
      shift: e.shiftKey,
      alt: e.altKey,
      mod,
      pressure: pressureOf(e),
      trail:
        coalesced.length > 1
          ? coalesced.map((c) => ({
              at: screenToPage(camera, local(c)),
              pressure: pressureOf(c),
            }))
          : undefined,
    };
  };

  /** Touch pointers, for pinching. */
  const touches = new Map<number, Point>();
  let pinch: { distance: number; center: Point } | undefined;

  const onPointerDown = (e: PointerEvent) => {
    host.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, local(e));
      if (touches.size === 2) {
        tools.cancelGesture();
        const [a, b] = [...touches.values()];
        pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
        return;
      }
    }
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    host.setPointerCapture(e.pointerId);
    tools.down(pointerOf(e), e.button);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, local(e));
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        view.pan(center.x - pinch.center.x, center.y - pinch.center.y);
        if (pinch.distance > 0) view.zoomBy(distance / pinch.distance, center);
        pinch = { distance, center };
        return;
      }
    }
    const p = pointerOf(e);
    tools.move(p);
    props.onPointer?.(p.at);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (pinch) {
        if (touches.size < 2) pinch = undefined;
        return;
      }
    }
    if (host.hasPointerCapture(e.pointerId))
      host.releasePointerCapture(e.pointerId);
    tools.up(pointerOf(e));
  };

  // Wheel must be non-passive to stop the page (and browser zoom) moving.
  onMount(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Trackpad pinches arrive as ctrl+wheel with small deltas.
        const clamped = Math.max(-60, Math.min(60, dy));
        view.zoomBy(Math.exp(-clamped * 0.01), p);
      } else if (e.shiftKey && dx === 0) view.pan(-dy, 0);
      else view.pan(-dx, -dy);
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
      view.zoomBy(g.scale / gestureScale, local(g));
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

  return (
    <div
      ref={host}
      // Focusable so a press on the canvas takes keys from panel fields.
      tabIndex={-1}
      class="relative size-full touch-none select-none overflow-hidden bg-inset outline-none"
      style={{ cursor: tools.cursor() }}
      data-testid="psd-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        touches.delete(e.pointerId);
        pinch = undefined;
        tools.cancelGesture();
      }}
      onPointerLeave={() => {
        tools.hover(null);
        props.onPointer?.(null);
      }}
      onDblClick={(e) => {
        const screen = local(e);
        tools.doubleClick({
          screen,
          at: screenToPage(view.camera(), screen),
          shift: e.shiftKey,
          alt: e.altKey,
          mod: e.metaKey || e.ctrlKey,
          pressure: 1,
        });
      }}
      onDragOver={(e) => {
        const types = e.dataTransfer?.types ?? [];
        if (props.onDropFiles && types.includes('Files')) {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const files = [...(e.dataTransfer?.files ?? [])].filter((f) =>
          f.type.startsWith('image/')
        );
        if (!props.onDropFiles || files.length === 0) return;
        e.preventDefault();
        props.onDropFiles(files, screenToPage(view.camera(), local(e)));
      }}
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
