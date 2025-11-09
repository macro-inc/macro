import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { createMemo, type ParentProps, Show } from 'solid-js';

export type DroppapleItemProps = {
  type: ItemType;
  context?: string;
  isEditing?: boolean;
  id: string;
  fileType?: FileType;
  name: string;
  isOwner: boolean;
  parentId?: string;
  small?: boolean;
  lastEdited?: string | number;
  depth?: number;
  deactivated?: boolean;
};

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      droppable: any; // or a more specific type if you have one
    }
  }
}

export type DroppableData = {
  type: ItemType | 'explorer-base';
  name: string;
  id: string;
  context?: string;
  isOwner?: boolean;
  parentId?: string;
  depth?: number;
};

export function DroppableItem(props: ParentProps<DroppapleItemProps>) {
  const data: DroppableData = {
    type: props.type,
    name: props.name,
    id: props.id,
    isOwner: props.isOwner,
    parentId: props.parentId ?? undefined,
    depth: props.depth,
  };
  const droppableId = props.context ? `${props.id}-${props.context}` : props.id;
  const droppable = createDroppable(droppableId, data);
  const [state] = useDragDropContext() ?? [];

  const draggable = createMemo(() => state?.active.draggable);

  const activeClass = () => {
    if (droppable.isActiveDroppable) {
      // Drag is drop, no-op
      if (draggable()?.data.id === props.id) {
        return '';
      }
      if (props.type === 'project') {
        return 'droppable rounded-lg bg-accent/20';
      } else {
        return `explorer-child-${props.depth}`;
      }
    }
    return '';
  };
  return (
    <Show
      when={!props.isEditing && !props.deactivated}
      fallback={props.children}
    >
      <div use:droppable class={`${activeClass()}`}>
        {props.children}
      </div>
    </Show>
  );
}
