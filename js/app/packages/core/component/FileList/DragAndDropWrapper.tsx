import { DraggableItem } from '@core/component/FileList/DraggableItem';
import { DroppableItem } from '@core/component/FileList/DroppableItem';
import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Item } from '@service-storage/generated/schemas/item';
import type { Accessor, ParentProps, Setter } from 'solid-js';
import type { FileListSize } from './constants';

type DragAndDropWrapperProps = {
  itemType: ItemType;
  fileType?: FileType;
  id: string;
  name: string;
  isOwner: boolean;
  parentId?: string;
  lastEdited: string;
  depth?: number;
  context?: string;
  isEditing?: boolean;
  selectedItems: Accessor<Item[]>;
  setSelectedItems: Setter<Item[]>;
  size?: FileListSize;
  deactivated?: boolean;
};

export function DragAndDropWrapper(
  props: ParentProps<DragAndDropWrapperProps>
) {
  if (props.id === 'trash') {
    return (
      <DroppableItem
        id={props.id}
        type={props.itemType}
        fileType={props.fileType}
        name={props.name}
        isOwner={props.isOwner}
        parentId={props.parentId}
        depth={props.depth}
        context={props.context}
        isEditing={props.isEditing}
        deactivated={props.deactivated}
      >
        {props.children}
      </DroppableItem>
    );
  }
  return (
    <DraggableItem
      type={props.itemType}
      id={props.id}
      fileType={props.fileType}
      name={props.name}
      isOwner={props.isOwner}
      parentId={props.parentId}
      lastEdited={props.lastEdited}
      context={props.context}
      isEditing={props.isEditing}
      selectedItems={props.selectedItems}
      setSelectedItems={props.setSelectedItems}
      size={props.size}
      deactivated={props.deactivated}
    >
      <DroppableItem
        id={props.id}
        type={props.itemType}
        fileType={props.fileType}
        name={props.name}
        isOwner={props.isOwner}
        parentId={props.parentId}
        depth={props.depth}
        context={props.context}
        isEditing={props.isEditing}
        deactivated={props.deactivated}
      >
        {props.children}
      </DroppableItem>
    </DraggableItem>
  );
}
