import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Item } from '@service-storage/generated/schemas/item';
import type { DragEvent } from '@thisbeyond/solid-dnd';
import { createDraggable } from '@thisbeyond/solid-dnd';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type ParentProps,
  type Setter,
  Show,
} from 'solid-js';
import type { FileListSize } from './constants';

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      draggable: any; // or a more specific type if you have one
    }
  }
}

export type DraggableItemProps = {
  type: ItemType;
  context?: string;
  isEditing?: boolean;
  id: string;
  fileType?: FileType;
  name: string;
  selectedItems: Accessor<Item[]>;
  setSelectedItems: Setter<Item[]>;
  size?: FileListSize;
  deactivated?: boolean;
};

export type DragEventWithData = DragEvent & {
  draggable: {
    data: DraggableData;
  };
};

export type DraggableData = {
  name: string;
  id: string;
  type: ItemType;
  fileType?: FileType;
  size?: FileListSize;
};

export function DraggableItem(props: ParentProps<DraggableItemProps>) {
  const draggableData = createMemo(
    () =>
      ({
        id: props.id,
        name: props.name,
        type: props.type,
        fileType: props.fileType,
        size: props.size,
      }) as DraggableData
  );

  const draggableId = props.context ? `${props.id}-${props.context}` : props.id;

  let draggableRef: HTMLDivElement | undefined;
  const [draggable, setDraggable] = createSignal(
    createDraggable(draggableId, draggableData())
  );

  createEffect(() => {
    const data = draggableData();
    if (draggableRef) {
      const newDraggable = createDraggable(draggableId, data);
      setDraggable(() => newDraggable);
      newDraggable(draggableRef);
    }
  });

  return (
    <Show
      when={!props.isEditing && !props.deactivated}
      fallback={props.children}
    >
      <div
        ref={draggableRef}
        use:draggable={draggable()}
        class={`${draggable().isActiveDraggable ? 'z-side-panel-layout pointer-events-none' : ''}`}
      >
        {props.children}
      </div>
    </Show>
  );
}
