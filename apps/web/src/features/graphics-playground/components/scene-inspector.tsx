import {
  children,
  type GraphicsEditor,
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
        Scene tree · select a node to edit it directly
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
            if (id)
              props.editor.reparent(
                id,
                document.rootId,
                children(document).length + 10
              );
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
