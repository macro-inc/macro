import type { DragEvent } from '@thisbeyond/solid-dnd';
import type { EntityData } from './entity';

export type DragEventWithData = DragEvent & {
  draggable: {
    data: EntityData;
  };
};
