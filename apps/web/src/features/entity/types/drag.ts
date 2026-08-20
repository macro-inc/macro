import type { DragEvent } from '@thisbeyond/solid-dnd';
import type { Accessor } from 'solid-js';
import type { EntityData } from './entity';

export type EntityDragOperation = 'move' | 'copy';

export type EntityDragData = EntityData & {
  dragType: 'entity';
  operation: Accessor<EntityDragOperation>;
  splitId?: string;
};

export type EntityDragEvent = DragEvent & {
  draggable: {
    data: EntityDragData;
  };
};

/** Checks whether data carries the tagged entity payload produced by the soup. */
export function isEntityDragData(data: unknown): data is EntityDragData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'dragType' in data &&
    data.dragType === 'entity'
  );
}

/** Checks whether a drag event carries the entity payload produced by the soup. */
export function isEntityDragEvent(event: DragEvent): event is EntityDragEvent {
  return isEntityDragData(event.draggable?.data);
}
