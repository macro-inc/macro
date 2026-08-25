import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import {
  getEntitySplitContent,
  SplitHeaderContextMenu,
} from '@components/app/split-layout/components/SplitHeader';
import { SplitPanelContext } from '@components/app/split-layout/context';
import { isEntityDragEvent } from '@entity';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { cn } from '@ui';
import {
  type ComponentProps,
  createMemo,
  Show,
  splitProps,
  useContext,
} from 'solid-js';

/**
 * Direct V2 split header owner. Views compose their controls as children while
 * retaining shared split context-menu and entity-drop behavior without header
 * slot portals.
 */
export function ComposedSplitHeader(props: ComponentProps<'header'>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const panel = useContext(SplitPanelContext);
  if (!panel) {
    throw new Error('<ComposedSplitHeader> must be used within a split panel');
  }

  const droppableId = `composed-split-header-${panel.handle.id}`;
  const droppable = createDroppable(droppableId, { type: 'split-header' });
  const [dragDropState, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];
  const isEntityDraggingOver = createMemo(() => {
    const data = dragDropState?.active.draggable?.data;
    return (
      data?.dragType === 'entity' &&
      dragDropState?.active.droppable?.id === droppableId
    );
  });

  onDragEnd((event) => {
    if (!isEntityDragEvent(event) || event.droppable?.id !== droppableId) return;
    const data = event.draggable?.data;
    if (!data || data.dragType !== 'entity') return;

    const current = panel.handle.content();
    const next = getEntitySplitContent(data);
    if (!next) return;
    if (current.type === next.type && current.id === next.id) return;

    void openEntityInSplitFromUnifiedList(data, {
      splitHandle: panel.handle,
      allowDuplicate: true,
    });
  });

  return (
    <SplitHeaderContextMenu>
      <header
        {...rest}
        class={cn('relative', local.class, isEntityDraggingOver() && 'bg-active')}
        ref={droppable}
      >
        {local.children}
        <Show when={isEntityDraggingOver()}>
          <div class="pointer-events-none absolute inset-0 z-modal-overlay flex items-center justify-center rounded-xl bg-modal-overlay pattern-diagonal-4 pattern-edge-muted">
            <div class="min-w-0 max-w-[min(28rem,calc(100%-3rem))] rounded-lg border border-edge bg-surface px-4 py-3 text-sm text-ink shadow-lg shadow-drop-shadow">
              <span class="text-ink-muted">Open in this split</span>
            </div>
          </div>
        </Show>
      </header>
    </SplitHeaderContextMenu>
  );
}
