import type { DragEvent } from '@thisbeyond/solid-dnd';
import type { EntityData } from './entity';
import type { Accessor } from 'solid-js';

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
