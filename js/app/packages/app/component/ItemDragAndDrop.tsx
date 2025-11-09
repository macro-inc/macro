import type { FileListSize } from '@core/component/FileList/constants';
import type { DragEventWithData } from '@core/component/FileList/DraggableItem';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useHistoryTree } from '@service-storage/history';
import { useProjects } from '@service-storage/projects';
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  mostIntersecting,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { EntityIcon } from 'core/component/EntityIcon';
import { updateItemParentOnDrop } from 'core/component/FileList/updateItemParentOnDrop';
import { createMemo, type JSXElement } from 'solid-js';

export function ItemDragOverlay() {
  const [state] = useDragDropContext() ?? [];
  const activeDraggable = createMemo(() => {
    return state?.active.draggable;
  });
  const size: FileListSize = activeDraggable()?.data.size;

  const getEntityIconType = () => {
    const data = activeDraggable()?.data;
    if (!data) return 'default';

    if (data.type === 'document') {
      return fileTypeToBlockName(data.fileType, true);
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
        <EntityIcon size={size ?? 'sm'} targetType={getEntityIconType()} />
        <TruncatedText size={size ?? 'sm'}>
          {activeDraggable()?.data.name}
        </TruncatedText>
      </div>
      {/* TODO post- multiselect exists */}
      {/* <Show when={activeDraggable()?.data.selectedItems.length > 1}>
        <div class={`${TEXT_SIZE_CLASSES[size ?? 'sm']} text-ink-muted pl-2`}>
          + {activeDraggable()?.data.selectedItems.length - 1} items
        </div>
      </Show> */}
    </div>
  );
}

export function ItemDragEndHandler() {
  const historyTree = useHistoryTree();
  const [, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];
  const { deleteItem, bulkDelete } = useItemOperations();

  onDragEnd((event) => {
    const { draggable, droppable } = event as DragEventWithData;
    let parentId = '';
    let parentName = '';

    if (draggable.data.id === droppable?.data.id) {
      return;
    }

    if (droppable && droppable.id === 'trash') {
      return deleteItem({
        itemType: draggable.data.type,
        id: draggable.data.id,
        itemName: draggable.data.name,
      });
    }

    if (droppable && droppable.data.type === 'explorer-base') {
      parentId = droppable.data.parentId ?? '';
      parentName = droppable.data.parentName ?? 'root';

      if (droppable.id === 'explorer-base-trash') {
        if (draggable.data.isBulkMove) {
          const items = draggable.data.selectedItems;
          if (!items) {
            return;
          }

          bulkDelete(items).then((result) => {
            if (result.success) {
              draggable.data.setSelectedItems?.([]);
            } else {
              draggable.data.setSelectedItems?.(result.failedItems);
            }
          });
        } else {
          // Handle single item deletion
          deleteItem({
            itemType: draggable.data.type,
            id: draggable.data.id,
            itemName: draggable.data.name,
          });
        }
        return;
      }
    } else if (droppable && droppable.data.type === 'project') {
      parentId = String(droppable.data.id);
      parentName = droppable.data.name;
    } else if (droppable && droppable.data.type !== 'project') {
      // check if droppable is in user's root list
      if (
        historyTree().rootItems.find(
          (item) => item.item.id === droppable.data.id
        )
      ) {
        parentId = '';
        parentName = 'root';
      }
      // if not, update parent to droppable parent
      else {
        const projects = useProjects();
        const parentProject = projects().find(
          (project) => project.id === droppable.data.parentId
        );
        if (!parentProject) {
          return;
        }
        parentId = parentProject.id;
        parentName = parentProject.name;
      }
    }

    updateItemParentOnDrop({
      draggable: draggable as DragEventWithData['draggable'],
      parentId,
      parentName,
    });
  });

  return '';
}

export function ItemDndProvider(props: { children: JSXElement }) {
  return (
    <DragDropProvider collisionDetector={mostIntersecting}>
      <DragDropSensors />
      <ItemDragEndHandler />
      {props.children}
      <DragOverlay class="z-drag">
        <ItemDragOverlay />
      </DragOverlay>
    </DragDropProvider>
  );
}
