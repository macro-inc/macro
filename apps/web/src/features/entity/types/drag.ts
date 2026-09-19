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

const ENTITY_DRAG_TYPES = [
  'channel',
  'channel_message',
  'channel_thread',
  'chat',
  'document',
  'email',
  'project',
  'call',
  'crm_company',
  'crm_contact',
  'automation',
  'reminder',
  'calendar_event',
  'foreign',
] as const satisfies readonly EntityData['type'][];

function isEntityType(value: unknown): value is EntityData['type'] {
  return (
    typeof value === 'string' &&
    ENTITY_DRAG_TYPES.some((entityType) => entityType === value)
  );
}

/** Checks whether data carries the tagged entity payload produced by the soup. */
export function isEntityDragData(data: unknown): data is EntityDragData {
  if (typeof data !== 'object' || data === null) return false;

  return (
    'dragType' in data &&
    data.dragType === 'entity' &&
    'operation' in data &&
    typeof data.operation === 'function' &&
    'id' in data &&
    typeof data.id === 'string' &&
    'name' in data &&
    typeof data.name === 'string' &&
    'ownerId' in data &&
    typeof data.ownerId === 'string' &&
    'type' in data &&
    isEntityType(data.type) &&
    (!('splitId' in data) ||
      data.splitId === undefined ||
      typeof data.splitId === 'string')
  );
}

/** Checks whether a drag event carries the entity payload produced by the soup. */
export function isEntityDragEvent(event: DragEvent): event is EntityDragEvent {
  return isEntityDragData(event.draggable?.data);
}
