/**
 * The canvas: rendered tiles underneath, the canvas UI on top, and the
 * tools' pointer gestures (`create-canvas-gestures`). Scroll pans;
 * ⌘/Ctrl+scroll, ⌥+scroll, and pinches zoom.
 */

import { createTileCompositor } from '@app/features/block-fig/primitives/create-tile-compositor';
import type { EdgeRect } from '@core/ai-engine/types';
import { createEffect, type JSX, on, onCleanup, onMount, Show } from 'solid-js';
import {
  drawOverlay,
  type OverlayModel,
  type OverlayShape,
  SELECTION_COLOR,
} from '../components/canvas-overlay';
import { PeerCursors } from '../components/peer-presence';
import { type Matrix, type Point, toRect } from '../core/geometry';
import { type PathData, transformPath } from '../core/path';
import type { PeerOverlay } from '../core/presence';
import type { AiEditor } from '../primitives/create-ai-editor';
import type { AiViewer } from '../primitives/create-ai-viewer';
import { createCanvasGestures } from '../primitives/create-canvas-gestures';

/** Resolves any CSS color to sRGB bytes. */
function cssToRgb(color: string): [number, number, number] | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/** Whether a pasteboard color is dark (the overlay draws light on it). */
const isDark = ([r, g, b]: [number, number, number]) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b < 110;

export interface CanvasInvalidator {
  /** Re-renders a changed canvas area. */
  invalidate: (rect: EdgeRect) => void;
  /** Re-renders everything (fonts arrived, say). */
  refresh: () => void;
}

export function AiCanvas(props: {
  viewer: AiViewer;
  editor: AiEditor;
  /** Space is held (a temporary hand tool). */
  spaceHeld: () => boolean;
  /** ⌥/Alt is held (the zoom tool zooms out). */
  altHeld: () => boolean;
  /** Called with the canvas's re-render hooks. */
  onInvalidator: (invalidator: CanvasInvalidator) => void;
  /** Start typing into a text object (at a character, when known). */
  onEditText: (id: number, at?: Point) => void;
  /** Other people on the canvas, when the document is shared. */
  peers?: () => PeerOverlay[];
  /** The pointer in canvas coordinates (`null` when it leaves). */
  onPointer?: (canvas: Point | null) => void;
  children?: JSX.Element;
}) {
  const viewer = props.viewer;
  const editor = props.editor;
  let host!: HTMLDivElement;
  let tileCanvas!: HTMLCanvasElement;
  let overlayCanvas!: HTMLCanvasElement;
  let dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  let frame: number | undefined;
  const requestDraw = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      draw();
    });
  };

  const gestures = createCanvasGestures({
    viewer,
    editor,
    host: () => host,
    spaceHeld: props.spaceHeld,
    altHeld: props.altHeld,
    requestDraw,
    onEditText: (id, at) => props.onEditText(id, at),
    onPointer: (p) => props.onPointer?.(p),
  });

  const compositor = createTileCompositor({
    engine: viewer.engine,
    onTile: requestDraw,
  });
  onCleanup(() => {
    compositor.dispose();
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  // ---- the pasteboard and tiles --------------------------------------------

  let background: [number, number, number] = [228, 228, 228];
  let shown: { outline: boolean; background: string } | undefined;
  const pasteboard = () => `rgb(${background.join(', ')})`;

  const view = () => ({
    camera: viewer.camera(),
    viewport: viewer.viewport(),
    dpr,
  });

  /** Starts the tiles over (a new view mode, pasteboard color, or fonts). */
  const restart = () => {
    const outline = viewer.outlineView();
    shown = { outline, background: pasteboard() };
    viewer.engine.setBackground(background);
    compositor.setPage({
      page: 0,
      outline,
      content: viewer.content(),
      background: pasteboard(),
    });
    compositor.update(view());
    requestDraw();
  };

  /** The pasteboard follows the app's theme (the host's own background). */
  const readTheme = () => {
    const rgb = cssToRgb(getComputedStyle(host).backgroundColor);
    if (!rgb || rgb.join() === background.join()) return false;
    background = rgb;
    return true;
  };

  props.onInvalidator({
    invalidate: (rect) => {
      compositor.invalidate(toRect(rect));
      requestDraw();
    },
    refresh: () => restart(),
  });

  // The compositor and canvases are external systems synced from state.
  createEffect(
    on([viewer.ready, viewer.outlineView], ([ready, outline]) => {
      if (!ready) return;
      if (shown?.outline === outline && shown.background === pasteboard())
        return;
      restart();
    })
  );
  createEffect(
    on(
      viewer.content,
      (content) => {
        if (shown) compositor.setContent(content);
        requestDraw();
      },
      { defer: true }
    )
  );
  createEffect(
    on([viewer.camera, viewer.viewport], () => {
      if (viewer.viewport().w <= 0 || !shown) return;
      compositor.update(view());
      requestDraw();
    })
  );

  // ---- the overlay ---------------------------------------------------------

  const colorOf = (id: number) => {
    const c = viewer.layerColor(id);
    return c ? `rgb(${c.join(', ')})` : SELECTION_COLOR;
  };

  /** An object's outline: its path, or its bounds. */
  const shapeOf = (info: {
    id: number;
    kind: string;
    path: PathData | null;
    transform: Matrix;
    bounds: EdgeRect | null;
  }): OverlayShape | undefined => {
    const color = colorOf(info.id);
    if (info.kind === 'path' && info.path)
      return { path: transformPath(info.path, info.transform), color };
    return info.bounds ? { rect: toRect(info.bounds), color } : undefined;
  };

  /** The highlight under the pointer, unless selected or mid-drag. */
  const hoverShape = () => {
    const hover = viewer.hover();
    if (!hover || gestures.dragging()) return undefined;
    return viewer.selected().includes(hover.id) ? undefined : shapeOf(hover);
  };

  const selectionBox = () => {
    const box = viewer.selectionBounds();
    if (!box || viewer.tool() === 'direct' || editor.editingText())
      return undefined;
    return {
      rect: box,
      color: colorOf(viewer.selected()[0] ?? 0),
      handles: gestures.transformable(),
    };
  };

  const anchors = () => {
    const direct = gestures.editedPath();
    if (!direct) return undefined;
    return {
      anchors: direct.anchors,
      selected: gestures.chosenAnchor(),
      color: colorOf(direct.info.id),
    };
  };

  const overlayModel = (): OverlayModel => ({
    camera: viewer.camera(),
    viewport: viewer.viewport(),
    dpr,
    dark: isDark(background),
    artboards: viewer
      .artboards()
      .map((a) => ({ id: a.id, name: a.name, rect: toRect(a.rect) })),
    artboard: viewer.tool() === 'artboard' ? viewer.artboard() : undefined,
    hover: hoverShape(),
    selection: viewer
      .infos()
      .flatMap((i) => (i.kind === 'path' ? (shapeOf(i) ?? []) : [])),
    box: selectionBox(),
    anchors: anchors(),
    preview: gestures.preview(),
    pen: gestures.pen(),
    marquee: gestures.marquee(),
    peers: props.peers?.(),
  });

  function draw() {
    const v = view();
    if (v.viewport.w <= 0) return;
    const ctx = tileCanvas.getContext('2d', { alpha: false });
    if (ctx && shown) compositor.draw(ctx, v);
    else if (ctx) {
      ctx.fillStyle = pasteboard();
      ctx.fillRect(0, 0, tileCanvas.width, tileCanvas.height);
    }
    const octx = overlayCanvas.getContext('2d');
    if (octx) drawOverlay(octx, overlayModel());
  }

  createEffect(
    on(
      [
        viewer.infos,
        viewer.hover,
        viewer.tool,
        viewer.artboard,
        viewer.summary,
        viewer.rows,
        editor.penPoints,
        editor.editingText,
        () => props.peers?.(),
      ],
      requestDraw
    )
  );

  // ---- size and theme --------------------------------------------------------

  onMount(() => {
    readTheme();
    const observer = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(r.width * dpr));
      const height = Math.max(1, Math.round(r.height * dpr));
      viewer.resize({ w: r.width, h: r.height });
      // Sizing a canvas clears it, so it is drawn again before this frame
      // is painted (waiting a frame would show it blank).
      if (tileCanvas.width === width && tileCanvas.height === height) {
        requestDraw();
        return;
      }
      for (const canvas of [tileCanvas, overlayCanvas]) {
        canvas.width = width;
        canvas.height = height;
      }
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
      if (shown) compositor.update(view());
      draw();
    });
    observer.observe(host);
    // A theme switch changes the pasteboard: render the tiles again.
    const themes = new MutationObserver(() => {
      if (readTheme() && shown) restart();
    });
    themes.observe(document.documentElement, { attributes: true });
    onCleanup(() => {
      observer.disconnect();
      themes.disconnect();
    });
  });

  // ---- wheel and trackpad ------------------------------------------------------

  // Wheel must be non-passive to stop the page (and browser zoom) moving.
  onMount(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = gestures.local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Trackpad pinches arrive as ctrl+wheel with small deltas; ⌥+scroll
        // zooms, as in Illustrator.
        const clamped = Math.max(-60, Math.min(60, dy || dx));
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
      viewer.zoomBy(g.scale / gestureScale, gestures.local(g));
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

  // The camera moves the overlay and its cursors; tools change the cursor.
  createEffect(
    on([viewer.camera, viewer.tool, props.spaceHeld, props.altHeld], () => {
      if (host) gestures.showCursor();
      requestDraw();
    })
  );

  const drop = (e: DragEvent) => {
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) =>
      f.type.startsWith('image/')
    );
    if (!editor.enabled() || files.length === 0) return;
    e.preventDefault();
    void editor.placeImages(files, gestures.at(gestures.local(e)));
  };

  return (
    <div
      ref={host}
      // Focusable so a press on the canvas takes keys from the panels;
      // shortcuts bubble to the editor.
      tabIndex={-1}
      class="relative size-full touch-none select-none overflow-hidden bg-edge-muted outline-none"
      data-testid="ai-canvas"
      onPointerDown={gestures.onPointerDown}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={gestures.onPointerUp}
      onPointerCancel={gestures.onPointerUp}
      onPointerLeave={gestures.onPointerLeave}
      onDblClick={(e) => void gestures.onDoubleClick(e)}
      onDragOver={(e) => {
        if (editor.enabled() && e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={drop}
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
