import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { createGraphicsEditor } from '@macro-inc/graphics';
import {
  createGraphicsProjection,
  GraphicsSurface,
} from '@macro-inc/graphics/solid';
import { onCleanup } from 'solid-js';

export default function GraphicsPlayground() {
  const editor = createGraphicsEditor([
    {
      id: 'rectangle-a',
      type: 'rectangle',
      geometry: { x: 96, y: 96, width: 240, height: 160 },
      appearance: { fill: 'var(--color-accent)', stroke: 'var(--color-ink)' },
    },
    {
      id: 'rectangle-b',
      type: 'rectangle',
      geometry: { x: 400, y: 192, width: 180, height: 240 },
      appearance: {
        fill: 'var(--color-panel)',
        stroke: 'var(--color-ink-muted)',
      },
    },
    {
      id: 'rectangle-c',
      type: 'rectangle',
      geometry: { x: 176, y: 336, width: 160, height: 112 },
      appearance: { fill: 'var(--color-input)', stroke: 'var(--color-accent)' },
    },
  ]);
  onCleanup(editor.dispose);
  const { camera } = createGraphicsProjection(editor);
  let surfaceHost!: HTMLDivElement;
  const zoom = (factor: number) =>
    editor.zoomAt(
      { x: surfaceHost.clientWidth / 2, y: surfaceHost.clientHeight / 2 },
      editor.getCamera().scale * factor
    );
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Graphics playground" />
      </SplitHeaderLeft>
      <div class="@container flex size-full min-h-0 flex-col bg-panel text-ink">
        <div class="flex flex-wrap items-center gap-3 border-b border-edge-muted px-4 py-3">
          <span
            class="mr-auto text-sm font-medium"
            title="Scroll to pan · Middle or Space + drag · Ctrl/⌘ + scroll to zoom"
          >
            Infinite canvas
          </span>
          <span class="hidden text-xs text-ink-muted @2xl:block">
            Scroll to pan · Space + drag · Ctrl/⌘ + scroll to zoom
          </span>
          <button
            type="button"
            class="rounded border border-edge-muted px-2 py-1 hover:bg-input"
            aria-label="Zoom out"
            onClick={() => zoom(1 / 1.25)}
          >
            −
          </button>
          <output
            class="w-14 text-center text-xs tabular-nums"
            aria-label="Zoom level"
          >
            {Math.round(camera().scale * 100)}%
          </output>
          <button
            type="button"
            class="rounded border border-edge-muted px-2 py-1 hover:bg-input"
            aria-label="Zoom in"
            onClick={() => zoom(1.25)}
          >
            +
          </button>
          <button
            type="button"
            class="rounded border border-edge-muted px-2 py-1 text-xs hover:bg-input"
            onClick={() => editor.resetCamera()}
          >
            Reset view
          </button>
        </div>
        <div ref={surfaceHost} class="min-h-0 flex-1">
          <GraphicsSurface
            editor={editor}
            gridColor="var(--color-edge-muted)"
            class="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          />
        </div>
        <div class="flex gap-4 border-t border-edge-muted px-4 py-2 text-xs text-ink-muted">
          <span>3 rectangles · Navigation preview</span>
          <span class="ml-auto tabular-nums">
            Camera {Math.round(camera().x)}, {Math.round(camera().y)}
          </span>
        </div>
      </div>
    </>
  );
}
