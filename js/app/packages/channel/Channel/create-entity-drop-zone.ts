import type { EntityData, EntityDragData, EntityDragEvent } from '@entity';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, createMemo } from 'solid-js';

type CreateEntityDropZoneOptions = {
  droppableId: string;
  /** Called when a soup entity is dropped onto this zone. */
  onDropEntity: (entity: EntityData) => void;
};

type EntityDropZone = {
  droppable: ReturnType<typeof createDroppable>;
  isDraggingOver: Accessor<boolean>;
};

export function createEntityDropZone(
  options: CreateEntityDropZoneOptions
): EntityDropZone {
  const droppable = createDroppable(options.droppableId);

  const [state, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];

  const entityDragData = createMemo(() => {
    const draggable = state?.active.draggable;
    if (!draggable) return;
    const dragData = draggable.data;
    if (!dragData || dragData.dragType !== 'entity') return;
    return dragData as EntityDragData;
  });

  const isDraggingOver = createMemo(() => {
    const dragData = entityDragData();
    if (!dragData) return false;

    const activeDroppable = state?.active.droppable;
    return !!activeDroppable && activeDroppable.id === options.droppableId;
  });

  onDragEnd((event: EntityDragEvent) => {
    if (!event.droppable) return;
    if (event.droppable.id !== options.droppableId) return;

    const data = event.draggable?.data;
    if (!data || data.dragType !== 'entity') return;

    options.onDropEntity(data);
  });

  return { droppable, isDraggingOver };
}
