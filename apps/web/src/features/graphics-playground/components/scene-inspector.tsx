import {
  type GraphicsEditor,
  type LayerOperation,
  paintOrder,
  roots,
} from '@macro-inc/graphics';
import { createGraphicsProjection } from '@macro-inc/graphics/solid';
import { For } from 'solid-js';

export function SceneInspector(props: { editor: GraphicsEditor }) {
  const { document, session } = createGraphicsProjection(props.editor);
  const depth = (id: string) => {
    let level = 0,
      node = document.items[id];
    while (
      node &&
      node.type !== 'surface' &&
      node.placement.parentId !== document.rootId
    ) {
      level++;
      node = document.items[node.placement.parentId];
    }
    return level;
  };
  return (
    <aside class="max-h-48 shrink-0 overflow-auto border-t border-edge-muted p-3 text-xs">
      <div class="mb-2 font-medium">
        Scene tree · back to front · select a node to edit it directly
      </div>
      <div class="mb-2 flex flex-wrap gap-2">
        <For
          each={
            [
              { operation: 'back', label: 'Send to back' },
              { operation: 'backward', label: 'Send backward' },
              { operation: 'forward', label: 'Bring forward' },
              { operation: 'front', label: 'Bring to front' },
            ] satisfies { operation: LayerOperation; label: string }[]
          }
        >
          {(action) => (
            <button
              type="button"
              class="rounded border border-edge-muted px-2 py-1 disabled:opacity-40"
              disabled={!session().selectedIds.length}
              onClick={() => props.editor.reorderSelection(action.operation)}
            >
              {action.label}
            </button>
          )}
        </For>
      </div>
      <div class="flex flex-col items-start gap-1">
        <For each={paintOrder(document)}>
          {(id) => (
            <button
              type="button"
              class="rounded border border-edge-muted px-2 py-1 aria-pressed:bg-accent aria-pressed:text-accent-contrast"
              style={{ 'margin-left': `${depth(id) * 12}px` }}
              aria-pressed={session().selectedIds.includes(id)}
              onClick={() => props.editor.select(id)}
            >
              {id} ({document.items[id]?.type})
            </button>
          )}
        </For>
        <button
          type="button"
          class="rounded border border-edge-muted px-2 py-1 disabled:opacity-40"
          disabled={
            !session().selectedId ||
            document.items[session().selectedId ?? '']?.type === 'surface'
          }
          onClick={() => {
            const id = session().selectedId;
            if (id) props.editor.reparent(id, document.rootId);
          }}
        >
          Move selected to root
        </button>
      </div>
      <p class="mt-2 text-ink-muted">
        Canvas clicks select the outer group. Alt-click targets a rectangle.
        Drag the circle above a selection to rotate. Selection roots:{' '}
        {roots(document, session().selectedIds).join(', ') || 'none'}.
      </p>
    </aside>
  );
}
