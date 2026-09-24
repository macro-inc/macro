import {
  type GraphicsEditor,
  isShape,
  paintOrder,
  type ShapeKind,
} from '@macro-inc/graphics';
import type { GraphicsPresence } from '@macro-inc/graphics/loro';
import { CollaborativeGraphicsSurface } from '@macro-inc/graphics/loro/solid';
import { createGraphicsProjection } from '@macro-inc/graphics/solid';
import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { SceneInspector } from './scene-inspector';

export function PeerCanvas(props: {
  name: string;
  editor: GraphicsEditor;
  presence: GraphicsPresence;
}) {
  const [tool, setTool] = createSignal<'select' | ShapeKind>('select');
  const { document, session, camera } = createGraphicsProjection(props.editor);
  let host!: HTMLDivElement;
  const fit = () =>
    props.editor.fitScene({
      width: host.clientWidth,
      height: host.clientHeight,
    });
  const groups = () =>
    paintOrder(document).filter((id) => document.items[id]?.type === 'group');
  const hasShape = () =>
    session().selectedIds.some((id) => isShape(document.items[id]));
  onMount(() => {
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(host);
    onCleanup(() => resize.disconnect());
  });
  return (
    <section
      aria-label={`${props.name}'s editor`}
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded border border-edge-muted bg-panel"
    >
      <div class="flex flex-wrap items-center gap-2 border-b border-edge-muted p-2 text-xs">
        <strong
          class="mr-auto text-sm"
          style={{ color: props.presence.identity.color }}
        >
          {props.name}
        </strong>
        <button type="button" onClick={fit}>
          Fit
        </button>
        <output aria-label={`${props.name} zoom`}>
          {Math.round(camera().scale * 100)}%
        </output>
        <button
          type="button"
          disabled={!session().canUndo}
          onClick={() => props.editor.undo()}
          class="disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!session().canRedo}
          onClick={() => props.editor.redo()}
          class="disabled:opacity-40"
        >
          Redo
        </button>
      </div>
      <div class="flex flex-wrap gap-2 border-b border-edge-muted p-2 text-xs">
        <For each={['select', 'rectangle', 'ellipse'] as const}>
          {(kind) => (
            <button
              type="button"
              aria-pressed={tool() === kind}
              class="rounded border border-edge-muted px-2 py-1 capitalize aria-pressed:bg-accent aria-pressed:text-accent-contrast"
              onClick={() => {
                props.editor.cancelShape();
                props.editor.cancelTransform();
                setTool(kind);
              }}
            >
              {kind}
            </button>
          )}
        </For>
        <button
          type="button"
          disabled={!hasShape()}
          class="disabled:opacity-40"
          onClick={() =>
            props.editor.setSelectionAppearance({ fill: 'var(--color-accent)' })
          }
        >
          Fill
        </button>
        <button
          type="button"
          disabled={!hasShape()}
          class="disabled:opacity-40"
          onClick={() =>
            props.editor.setSelectionAppearance({ fill: 'transparent' })
          }
        >
          No fill
        </button>
        <button
          type="button"
          disabled={!session().selectedIds.length}
          class="disabled:opacity-40"
          onClick={() => props.editor.deleteSelection()}
        >
          Delete
        </button>
        <button
          type="button"
          disabled={
            session().selectedIds.length < 2 ||
            !session().selectedIds.every((id) => {
              const node = document.items[id],
                first = document.items[session().selectedIds[0] ?? ''];
              return (
                node &&
                first &&
                node.type !== 'surface' &&
                first.type !== 'surface' &&
                node.placement.parentId === first.placement.parentId
              );
            })
          }
          class="disabled:opacity-40"
          onClick={() => props.editor.groupSelection(crypto.randomUUID())}
        >
          Group
        </button>
        <button
          type="button"
          disabled={
            document.items[session().selectedId ?? '']?.type !== 'group'
          }
          class="disabled:opacity-40"
          onClick={() => props.editor.ungroupSelection()}
        >
          Ungroup
        </button>
      </div>
      <div ref={host} class="min-h-48 min-w-0 flex-1">
        <CollaborativeGraphicsSurface
          editor={props.editor}
          presence={props.presence}
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
        <summary class="px-3 py-2 text-xs">
          Layers · {session().selectedIds.length} selected
        </summary>
        <div class="absolute bottom-full z-10 max-h-72 w-full overflow-auto border-t border-edge-muted bg-panel shadow-lg">
          <SceneInspector editor={props.editor} />
          <label class="flex items-center gap-2 px-3 pb-3 text-xs">
            Move selected into
            <select
              aria-label="Move selected into group"
              class="rounded border border-edge-muted bg-input p-1"
              disabled={!session().selectedId}
              value=""
              onChange={(event) => {
                const id = session().selectedId,
                  parent = event.currentTarget.value;
                if (id && parent) props.editor.reparent(id, parent);
                event.currentTarget.value = '';
              }}
            >
              <option value="">Choose group…</option>
              <For
                each={groups().filter((id) => {
                  const selected = session().selectedId;
                  let current = document.items[id];
                  while (current && current.type !== 'surface') {
                    if (current.id === selected) return false;
                    current = document.items[current.placement.parentId];
                  }
                  return true;
                })}
              >
                {(id) => <option value={id}>{id}</option>}
              </For>
            </select>
          </label>
        </div>
      </details>
    </section>
  );
}
