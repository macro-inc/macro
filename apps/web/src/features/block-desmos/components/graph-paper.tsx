import { createEffect, onCleanup } from 'solid-js';
import type { PlotScene, Viewport } from '../core/document';
import {
  defaultViewport,
  paintGraph,
  panViewport,
  screenToWorld,
  squareUnits,
  zoomViewport,
} from '../core/graph-paper';

export function GraphPaper(props: {
  scene: PlotScene | undefined;
  canEdit: boolean;
  onViewport: (viewport: Viewport) => void;
}) {
  let canvas: HTMLCanvasElement | undefined;
  let drag: { x: number; y: number; viewport: Viewport } | undefined;

  const draw = () => {
    if (!canvas || !props.scene) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintGraph(ctx, props.scene, rect.width, rect.height, dpr);
  };

  createEffect(draw);

  const onWheel = (event: WheelEvent) => {
    if (!canvas || !props.scene || !props.canEdit) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const [x, y] = screenToWorld(
      props.scene.viewport,
      rect.width,
      rect.height,
      event.clientX - rect.left,
      event.clientY - rect.top
    );
    const factor = event.deltaY < 0 ? 0.85 : 1.18;
    props.onViewport(zoomViewport(props.scene.viewport, factor, x, y));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!props.scene || !props.canEdit || event.button !== 0) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      viewport: props.scene.viewport,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || !canvas || !props.scene) return;
    const rect = canvas.getBoundingClientRect();
    const [x0, y0] = screenToWorld(
      drag.viewport,
      rect.width,
      rect.height,
      drag.x - rect.left,
      drag.y - rect.top
    );
    const [x1, y1] = screenToWorld(
      drag.viewport,
      rect.width,
      rect.height,
      event.clientX - rect.left,
      event.clientY - rect.top
    );
    props.onViewport(panViewport(drag.viewport, x0 - x1, y0 - y1));
  };

  const onPointerUp = () => {
    drag = undefined;
  };

  const resize = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry || !props.scene) return;
    const { width, height } = entry.contentRect;
    const next = squareUnits(props.scene.viewport, width, height);
    const v = props.scene.viewport;
    if (
      Math.abs(next.ymin - v.ymin) > 1e-6 ||
      Math.abs(next.ymax - v.ymax) > 1e-6
    ) {
      props.onViewport(next);
      return;
    }
    draw();
  });
  createEffect(() => {
    if (!canvas) return;
    resize.observe(canvas);
    onCleanup(() => resize.disconnect());
  });

  return (
    <div class="relative min-h-0 min-w-0 flex-1 bg-surface">
      <canvas
        ref={canvas}
        class="size-full cursor-grab touch-none active:cursor-grabbing"
        data-testid="desmos-graph"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div class="absolute top-3 right-3 flex flex-col overflow-hidden rounded border border-edge bg-surface shadow-sm">
        <button
          type="button"
          class="px-2.5 py-1 text-lg leading-none text-ink hover:bg-ink-extra-muted/10"
          title="Zoom in"
          disabled={!props.canEdit}
          onClick={() => {
            if (!props.scene || !props.canEdit) return;
            const v = props.scene.viewport;
            props.onViewport(
              zoomViewport(v, 0.7, (v.xmin + v.xmax) / 2, (v.ymin + v.ymax) / 2)
            );
          }}
        >
          +
        </button>
        <button
          type="button"
          class="border-t border-edge px-2.5 py-1 text-lg leading-none text-ink hover:bg-ink-extra-muted/10"
          title="Zoom out"
          disabled={!props.canEdit}
          onClick={() => {
            if (!props.scene || !props.canEdit) return;
            const v = props.scene.viewport;
            props.onViewport(
              zoomViewport(v, 1.4, (v.xmin + v.xmax) / 2, (v.ymin + v.ymax) / 2)
            );
          }}
        >
          −
        </button>
        <button
          type="button"
          class="border-t border-edge px-2.5 py-1 text-[11px] text-ink hover:bg-ink-extra-muted/10"
          title="Default viewport"
          disabled={!props.canEdit}
          onClick={() => {
            if (!canvas || !props.canEdit) return;
            const rect = canvas.getBoundingClientRect();
            props.onViewport(defaultViewport(rect.width, rect.height));
          }}
        >
          home
        </button>
      </div>
    </div>
  );
}
