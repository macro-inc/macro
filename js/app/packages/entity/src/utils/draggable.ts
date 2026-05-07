import { useDragOperation } from '@app/component/ItemDragAndDrop';
import { createDraggable } from '@thisbeyond/solid-dnd';
import { createUniqueId } from 'solid-js';
import type { EntityDragData } from '../types/drag';
import type { EntityData } from '../types/entity';

export function createEntityDraggable(options: {
  entity: EntityData;
  splitId?: string;
}): ReturnType<typeof createDraggable> {
  const { isAltKey } = useDragOperation();
  const draggableId = `${options.entity.id}-${options.splitId ?? createUniqueId()}`;

  const dragData: EntityDragData = {
    dragType: 'entity',
    splitId: options.splitId,
    ...options.entity,
    operation: () => (isAltKey() ? 'copy' : 'move'),
  };

  return createDraggable(draggableId, dragData);
}
