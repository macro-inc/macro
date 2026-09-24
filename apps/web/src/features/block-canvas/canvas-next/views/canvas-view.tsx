import {
  type Alignment,
  alignCommand,
  distributeCommand,
  drawableIds,
  type LayerOperation,
  screenToWorld,
} from '@macro-inc/graphics';
import { GraphicsSurface } from '@macro-inc/graphics/solid';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { CanvasClipboard } from '../clipboard';
import { CanvasLayers } from '../components/layers';
import { StyleInspector } from '../components/style-inspector';
import { createCanvasNextScene } from '../core/seed-scene';
import type {
  CanvasState,
  CanvasTool,
} from '../primitives/create-canvas-state';

export function CanvasView(props: {
  state: CanvasState;
  clipboard: CanvasClipboard;
  attachScope: (element: Element) => void;
}) {
  const state = props.state,
    editor = state.editor;
  let root!: HTMLDivElement, host!: HTMLDivElement;
  const [menu, setMenu] = createSignal<{ x: number; y: number }>();
  const fit = () => {
    editor.fitScene({
      width: host.clientWidth,
      height: Math.max(1, host.clientHeight - 80),
    });
    editor.panBy({ x: 0, y: 60 });
  };
  const focus = () =>
    host
      .querySelector<HTMLElement>('[aria-label="Graphics canvas"]')
      ?.focus({ preventScroll: true });
  const zoom = (factor: number) =>
    editor.zoomAt(
      { x: host.clientWidth / 2, y: host.clientHeight / 2 },
      editor.getCamera().scale * factor
    );
  onMount(() => {
    props.attachScope(root);
    onCleanup(props.clipboard.attach(root));
    fit();
    focus();
  });
  const toolItems: readonly {
    id: CanvasTool;
    label: string;
    icon: string;
    key: string;
  }[] = [
    { id: 'select', label: 'Select', icon: '↖', key: 'V' },
    { id: 'pan', label: 'Hand', icon: '✥', key: 'H' },
    { id: 'rectangle', label: 'Rectangle', icon: '□', key: 'R' },
    { id: 'ellipse', label: 'Ellipse', icon: '○', key: 'O' },
  ];
  return (
    <div
      ref={root}
      class="flex size-full min-h-0 flex-col bg-panel text-ink"
      data-canvas-next
      onKeyDown={(event) => {
        if (event.key === 'Escape') setMenu(undefined);
      }}
    >
      <header class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-edge-muted px-4 py-2">
        <div class="flex items-center gap-3">
          <span class="text-sm font-medium">Untitled canvas</span>
          <span class="rounded bg-accent-bg px-2 py-1 text-[10px] text-accent">
            Local demo
          </span>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
            disabled={!state.session().canUndo}
            onClick={editor.undo}
          >
            Undo
          </button>
          <button
            type="button"
            class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
            disabled={!state.session().canRedo}
            onClick={editor.redo}
          >
            Redo
          </button>
          <span class="mx-1 h-4 border-l border-edge-muted" />
          <button
            type="button"
            class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
            disabled={!state.selection().length}
            onClick={() => void props.clipboard.copy()}
          >
            Copy
          </button>
          <button
            type="button"
            class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => void props.clipboard.paste()}
          >
            Paste
          </button>
          <button
            type="button"
            class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
            disabled={!state.selection().length}
            onClick={state.duplicate}
          >
            Duplicate
          </button>
          <button
            type="button"
            class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => {
              editor.resetDocument(createCanvasNextScene());
              state.chooseTool('select');
              fit();
              state.setNotice('Fresh demo scene');
            }}
          >
            Reset demo
          </button>
        </div>
      </header>
      <div class="flex min-h-0 flex-1">
        <aside
          class="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-edge-muted"
          aria-label="Canvas inspector"
        >
          <StyleInspector
            count={state.shapes().length}
            value={state.appearanceValue}
            onChange={state.style}
          />
          <section
            class="space-y-2 border-b border-edge-muted p-3"
            aria-label="Arrange selection"
          >
            <h2 class="text-xs font-medium">Arrange</h2>
            <div class="grid grid-cols-3 gap-1">
              <For
                each={
                  [
                    'left',
                    'center',
                    'right',
                    'top',
                    'middle',
                    'bottom',
                  ] as const
                }
              >
                {(alignment: Alignment) => (
                  <button
                    type="button"
                    class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent capitalize"
                    aria-label={`Align ${alignment}`}
                    disabled={state.selection().length < 2}
                    onClick={() => editor.execute(alignCommand, alignment)}
                  >
                    {alignment}
                  </button>
                )}
              </For>
            </div>
            <div class="grid grid-cols-2 gap-1">
              <For each={['horizontal', 'vertical'] as const}>
                {(axis) => (
                  <button
                    type="button"
                    class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
                    disabled={state.selection().length < 3}
                    aria-label={`Distribute ${axis}`}
                    onClick={() => editor.execute(distributeCommand, axis)}
                  >
                    {axis === 'horizontal' ? 'Space ↔' : 'Space ↕'}
                  </button>
                )}
              </For>
            </div>
            <div class="grid grid-cols-2 gap-1">
              <button
                type="button"
                class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
                disabled={!state.canGroup()}
                onClick={state.group}
              >
                Group
              </button>
              <button
                type="button"
                class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
                disabled={!state.canUngroup()}
                onClick={state.ungroup}
              >
                Ungroup
              </button>
            </div>
            <div class="grid grid-cols-2 gap-1">
              <For
                each={
                  [
                    ['front', 'To front'],
                    ['back', 'To back'],
                    ['forward', 'Forward'],
                    ['backward', 'Backward'],
                  ] as const
                }
              >
                {([operation, label]: readonly [LayerOperation, string]) => (
                  <button
                    type="button"
                    class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
                    disabled={!state.selection().length}
                    onClick={() => editor.reorderSelection(operation)}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
          </section>
          <CanvasLayers
            document={state.document}
            selected={state.session().selectedIds}
            onSelect={(id, additive) => {
              state.chooseTool('select');
              if (additive) editor.toggleSelection(id);
              else editor.select(id);
            }}
          />
        </aside>
        <main
          class="relative min-w-0 flex-1"
          onPointerDown={() => setMenu(undefined)}
        >
          <div
            ref={host}
            class="absolute inset-0"
            onContextMenu={(event) => {
              event.preventDefault();
              focus();
              const rect = host.getBoundingClientRect();
              const id = editor.hitTest(
                screenToWorld(editor.getCamera(), {
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                })
              );
              if (id && !state.session().selectedIds.includes(id)) {
                state.chooseTool('select');
                editor.select(id);
              }
              setMenu({
                x: Math.min(
                  event.clientX - rect.left,
                  Math.max(0, rect.width - 190)
                ),
                y: Math.min(
                  event.clientY - rect.top,
                  Math.max(0, rect.height - 270)
                ),
              });
            }}
          >
            <GraphicsSurface
              editor={editor}
              input={{
                tool: state.tool,
                appearance: state.defaults,
                duplicateOnAltDrag: true,
                onShapeCreated: state.shapeCreated,
              }}
              gridColor="var(--color-edge-muted)"
            />
          </div>
          <nav
            aria-label="Drawing tools"
            class="absolute left-1/2 top-4 flex -translate-x-1/2 gap-1 rounded-xl border border-edge-muted bg-panel p-1.5 shadow-sm"
          >
            <For each={toolItems}>
              {(tool) => (
                <button
                  type="button"
                  aria-label={`${tool.label} tool`}
                  title={`${tool.label} (${tool.key})`}
                  aria-pressed={state.tool() === tool.id}
                  class="flex h-11 min-w-14 items-center justify-center gap-2 rounded-lg px-3 text-ink-muted hover:bg-hover data-[selected=true]:bg-accent-bg data-[selected=true]:text-accent"
                  data-selected={state.tool() === tool.id}
                  onClick={() => {
                    state.chooseTool(tool.id);
                    focus();
                  }}
                >
                  <span class="text-xl" aria-hidden="true">
                    {tool.icon}
                  </span>
                  <span class="text-[10px]">{tool.key}</span>
                </button>
              )}
            </For>
          </nav>
          <Show when={menu()}>
            {(position) => (
              <div
                role="menu"
                aria-label="Canvas actions"
                class="absolute z-20 flex w-44 flex-col rounded-lg border border-edge-muted bg-panel p-1 shadow-lg"
                style={{ left: `${position().x}px`, top: `${position().y}px` }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <For
                  each={[
                    {
                      label: 'Copy',
                      run: () => void props.clipboard.copy(),
                      enabled: () => !!state.selection().length,
                    },
                    {
                      label: 'Cut',
                      run: () => void props.clipboard.cut(),
                      enabled: () => !!state.selection().length,
                    },
                    {
                      label: 'Paste',
                      run: () => void props.clipboard.paste(),
                      enabled: () => true,
                    },
                    {
                      label: 'Duplicate',
                      run: state.duplicate,
                      enabled: () => !!state.selection().length,
                    },
                    {
                      label: 'Group',
                      run: state.group,
                      enabled: state.canGroup,
                    },
                    {
                      label: 'Ungroup',
                      run: state.ungroup,
                      enabled: state.canUngroup,
                    },
                    {
                      label: 'Delete',
                      run: editor.deleteSelection,
                      enabled: () => !!state.selection().length,
                    },
                  ]}
                >
                  {(action) => (
                    <button
                      type="button"
                      role="menuitem"
                      class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent text-left"
                      disabled={!action.enabled()}
                      onClick={() => {
                        action.run();
                        setMenu(undefined);
                        focus();
                      }}
                    >
                      {action.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
          <div class="absolute bottom-4 right-4 flex items-center rounded-lg border border-edge-muted bg-panel p-1 shadow-sm">
            <button
              type="button"
              class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="Zoom out"
              onClick={() => zoom(1 / 1.2)}
            >
              −
            </button>
            <output
              class="w-12 text-center text-xs tabular-nums"
              aria-label="Zoom level"
            >
              {Math.round(state.camera().scale * 100)}%
            </output>
            <button
              type="button"
              class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="Zoom in"
              onClick={() => zoom(1.2)}
            >
              +
            </button>
            <button
              type="button"
              class="rounded px-2.5 py-1.5 text-xs hover:bg-hover disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-accent"
              onClick={fit}
            >
              Fit
            </button>
          </div>
        </main>
      </div>
      <footer class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge-muted px-4 py-2 text-[11px] text-ink-muted">
        <span>
          {drawableIds(state.document).length} shapes ·{' '}
          {state.selection().length} selected
        </span>
        <span>
          Shift: add selection / proportional scale / 30° rotation ·
          Option-drag: duplicate · Arrows: nudge · Space: pan
        </span>
        <span class="ml-auto" role="status">
          {state.notice()}
        </span>
      </footer>
    </div>
  );
}
