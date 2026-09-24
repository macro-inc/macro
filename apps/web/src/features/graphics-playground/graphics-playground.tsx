import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import {
  createGraphicsEditor,
  drawableIds,
  type GraphicsDocument,
  roots,
  type ShapeKind,
  shapeDefinitions,
  shapeKinds,
} from '@macro-inc/graphics';
import {
  createGraphicsProjection,
  GraphicsSurface,
} from '@macro-inc/graphics/solid';
import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { SceneInspector } from './components/scene-inspector';
import { createGraphicsTestScene } from './core/test-scenes';

export default function GraphicsPlayground(
  props: {
    seedScene?: () => GraphicsDocument;
    label?: string;
    inspector?: boolean;
  } = {}
) {
  const seedScene = props.seedScene ?? createGraphicsTestScene;
  const editor = createGraphicsEditor(seedScene());
  onCleanup(editor.dispose);
  const [tool, setTool] = createSignal<'select' | ShapeKind>('select');
  const { camera, document, session } = createGraphicsProjection(editor);
  const canGroup = () => {
    const nodes = roots(document, session().selectedIds).map(
      (id) => document.items[id]
    );
    const first = nodes[0];
    return (
      nodes.length > 1 &&
      first &&
      first.type !== 'surface' &&
      nodes.every(
        (n) =>
          n &&
          n.type !== 'surface' &&
          n.placement.parentId === first.placement.parentId
      )
    );
  };
  let surfaceHost!: HTMLDivElement;
  const fitScene = () =>
    editor.fitScene({
      width: surfaceHost.clientWidth,
      height: surfaceHost.clientHeight,
    });
  onMount(() => {
    if (props.inspector) fitScene();
  });
  const resetTestScene = () => {
    editor.resetDocument(seedScene());
    editor.resetCamera();
    setTool('select');
    if (props.inspector) fitScene();
  };
  const zoom = (factor: number) =>
    editor.zoomAt(
      { x: surfaceHost.clientWidth / 2, y: surfaceHost.clientHeight / 2 },
      editor.getCamera().scale * factor
    );
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label={props.label ?? 'Graphics playground'} />
      </SplitHeaderLeft>
      <div class="@container flex size-full min-h-0 flex-col bg-panel text-ink">
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted px-3 py-2 text-xs">
          <button type="button" class="text-xs" onClick={fitScene}>
            Fit scene
          </button>
          <span
            class="mr-auto hidden text-sm font-medium @2xl:block"
            title="Scroll to pan · Middle or Space + drag · Ctrl/⌘ + scroll to zoom"
          >
            Infinite canvas
          </span>
          <span class="hidden text-xs text-ink-muted @2xl:block">
            Scroll to pan · Space + drag · Circle handle to rotate
          </span>
          <For each={['select', ...shapeKinds] as const}>
            {(value) => (
              <button
                type="button"
                class="rounded border border-edge-muted px-2 py-1 text-xs aria-pressed:bg-accent aria-pressed:text-accent-contrast"
                aria-pressed={tool() === value}
                onClick={() => {
                  editor.cancelShape();
                  editor.cancelTransform();
                  setTool(value);
                }}
              >
                {value === 'select' ? 'Select' : shapeDefinitions[value].label}
              </button>
            )}
          </For>
          <button
            type="button"
            class="text-xs disabled:opacity-40"
            disabled={!session().canUndo}
            onClick={() => editor.undo()}
          >
            Undo
          </button>
          <button
            type="button"
            class="text-xs disabled:opacity-40"
            disabled={!session().canRedo}
            onClick={() => editor.redo()}
          >
            Redo
          </button>
          <button
            type="button"
            class="text-xs disabled:opacity-40"
            disabled={!session().selectedIds.length}
            onClick={() => editor.deleteSelection()}
          >
            Delete
          </button>
          <button
            type="button"
            class="text-xs disabled:opacity-40"
            disabled={!canGroup()}
            onClick={() => editor.groupSelection(crypto.randomUUID())}
          >
            Group
          </button>
          <button
            type="button"
            class="text-xs disabled:opacity-40"
            disabled={
              document.items[session().selectedId ?? '']?.type !== 'group'
            }
            onClick={() => editor.ungroupSelection()}
          >
            Ungroup
          </button>
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
          <button
            type="button"
            class="rounded border border-edge-muted px-2 py-1 text-xs hover:bg-input"
            onClick={resetTestScene}
          >
            Reset test scene
          </button>
        </div>
        <div ref={surfaceHost} class="min-h-0 flex-1">
          <GraphicsSurface
            editor={editor}
            input={{
              tool,
              editing: true,
              appearance: () => ({
                fill: 'transparent',
                stroke: 'var(--color-accent)',
              }),
            }}
            gridColor="var(--color-edge-muted)"
            class="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          />
        </div>
        <details class="relative shrink-0 border-t border-edge-muted">
          <summary class="px-4 py-1 text-xs">Layers</summary>
          <div class="absolute bottom-full z-10 w-full bg-panel shadow-lg">
            <SceneInspector editor={editor} />
          </div>
        </details>
        <div class="flex gap-4 border-t border-edge-muted px-4 py-2 text-xs text-ink-muted">
          <span>
            {drawableIds(document).length} shapes ·{' '}
            {session().selectedIds.length
              ? `${session().selectedIds.length} selected`
              : 'Drag to select'}
          </span>
          <span class="ml-auto tabular-nums">
            Camera {Math.round(camera().x)}, {Math.round(camera().y)}
          </span>
        </div>
      </div>
    </>
  );
}
