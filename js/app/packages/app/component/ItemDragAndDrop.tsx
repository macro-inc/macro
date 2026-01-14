import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  mostIntersecting,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { EntityIcon } from 'core/component/EntityIcon';
import { createMemo, type JSXElement } from 'solid-js';

export function ItemDragOverlay() {
  const [state] = useDragDropContext() ?? [];
  const activeDraggable = createMemo(() => {
    return state?.active.draggable;
  });

  const getEntityIconType = () => {
    const data = activeDraggable()?.data;
    if (!data) return 'default';

    if (data.type === 'document') {
      return fileTypeToBlockName(data.subType?.type ?? data.fileType, true);
    }

    if (data.type === 'channel') {
      switch (data.channelType) {
        case 'direct_message':
          return 'directMessage';
        case 'organization':
          return 'company';
        default:
          return 'channel';
      }
    }

    if (data.type === 'email') {
      return data.isRead ? 'emailRead' : 'email';
    }

    return data.type ?? 'default';
  };

  return (
    <div class="w-auto max-w-[300px] flex flex-col gap-2 bg-active p-2 rounded-md z-drag shadow-sm pointer-events-none">
      <div class="flex flex-row items-center gap-2">
        <EntityIcon size="sm" targetType={getEntityIconType()} />
        <TruncatedText size="sm">{activeDraggable()?.data.name}</TruncatedText>
      </div>
      {/* TODO: when multiselect exists */}
      {/* <Show when={activeDraggable()?.data.selectedItems.length > 1}>
        <div class={`${TEXT_SIZE_CLASSES[size ?? 'sm']} text-ink-muted pl-2`}>
          + {activeDraggable()?.data.selectedItems.length - 1} items
        </div>
      </Show> */}
    </div>
  );
}

export function ItemDndProvider(props: { children: JSXElement }) {
  return (
    <DragDropProvider collisionDetector={mostIntersecting}>
      <DragDropSensors />
      {props.children}
      <DragOverlay class="z-drag">
        <ItemDragOverlay />
      </DragOverlay>
    </DragDropProvider>
  );
}
