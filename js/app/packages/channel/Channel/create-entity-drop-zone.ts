import type { EntityData, EntityDragData, EntityDragEvent } from '@entity';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { type Accessor, createMemo } from 'solid-js';

export type EntityDropCoordinates = {
  clientX: number;
  clientY: number;
};

type CreateEntityDropZoneOptions = {
  droppableId: string;
  /** Called when a soup entity is dropped onto this zone. */
  onDropEntity: (
    entity: EntityData,
    coordinates?: EntityDropCoordinates
  ) => void;
  /** Called while a soup entity is dragged over this zone. */
  onDragEntityMove?: (coordinates: EntityDropCoordinates) => void;
  /** Called when the active entity drag leaves this zone or ends. */
  onDragEntityEnd?: () => void;
};

type EntityDropZone = {
  droppable: ReturnType<typeof createDroppable>;
  isDraggingOver: Accessor<boolean>;
};

export function createEntityDropZone(
  options: CreateEntityDropZoneOptions
): EntityDropZone {
  const droppable = createDroppable(options.droppableId);

  const [state, { onDragEnd, onDragMove }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {}, onDragMove: () => {} },
  ];

  const currentCoordinates = (): EntityDropCoordinates | undefined => {
    const coordinates = state?.active.sensor?.coordinates.current;
    if (!coordinates) return undefined;
    return {
      clientX: coordinates.x,
      clientY: coordinates.y,
    };
  };

  const isOverThisDropZone = () =>
    droppable.isActiveDroppable ||
    state?.active.droppable?.id === options.droppableId;

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
    const data = event.draggable?.data;
    if (!data || data.dragType !== 'entity') return;

    options.onDragEntityEnd?.();
    if (!event.droppable) return;
    if (event.droppable.id !== options.droppableId) return;

    const coordinates = currentCoordinates();
    options.onDropEntity(data, coordinates);
  });

  onDragMove((event: EntityDragEvent) => {
    const data = event.draggable?.data;
    if (!data || data.dragType !== 'entity' || !isOverThisDropZone()) {
      options.onDragEntityEnd?.();
      return;
    }

    const coordinates = currentCoordinates();
    if (!coordinates) return;
    options.onDragEntityMove?.(coordinates);
  });

  return { droppable, isDraggingOver };
}
