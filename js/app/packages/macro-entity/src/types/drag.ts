import type { DragEvent } from '@thisbeyond/solid-dnd';
import type { EntityData } from './entity';

export type EntityDragEvent = DragEvent & {
  draggable: {
    data: EntityData;
  };
};
