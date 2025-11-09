import type { BlockName } from '@core/block';
import { NewItemMenuItems } from '@core/component/FileList/NewItemMenu';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/Menu';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import Unpin from '@icon/fill/push-pin-slash-fill.svg?component-solid';
import ArrowRight from '@icon/regular/arrow-right.svg?component-solid';
import ArrowsOutSimple from '@icon/regular/arrows-out-simple.svg?component-solid';
import ClockCounterClockwise from '@icon/regular/clock-counter-clockwise.svg?component-solid';
import CopySimple from '@icon/regular/copy-simple.svg?component-solid';
import PencilSimpleLine from '@icon/regular/pencil-simple-line.svg?component-solid';
import Plus from '@icon/regular/plus.svg?component-solid';
import Pin from '@icon/regular/push-pin.svg?component-solid';
import Trash from '@icon/regular/trash.svg?component-solid';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { ItemType } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { Item } from '@service-storage/generated/schemas/item';
import { useHistoryTree } from '@service-storage/history';
import { createResource, createSignal, Show, Suspense } from 'solid-js';
import { useItemOperations } from './useItemOperations';

type ItemContextMenuProps = {
  itemType: ItemType;
  id: string;
  name: string;
  blockName: BlockName;
  href: string;
  renameHandler: () => void;
  pinned: boolean;
  setIsCreatingProject: (isCreatingProject: boolean) => void;
  setIsExpanded?: (isExpanded: boolean) => void;
  selectedItems: Item[];
  setSelectedItems: (items: Item[]) => void;
  insideProjectBlock: boolean;
  setShowDeleteConfirmation: (showDeleteConfirmation: boolean) => void;
  isMultiSelected: boolean;
  setShowMoveToFolder: (showMoveToFolder: boolean) => void;
};

export function ItemContextMenu(props: ItemContextMenuProps) {
  const [showCreateNewSubmenu, setShowCreateNewSubmenu] = createSignal(false);
  const fileTree = useHistoryTree();
  const {
    copyItem,
    deleteItem,
    togglePin,
    bulkTogglePin,
    bulkCopy,
    getItemAccessLevel,
  } = useItemOperations();

  const copyHandler = () => {
    if (props.itemType !== 'project') {
      copyItem({
        itemType: props.itemType,
        id: props.id,
        name: props.name,
      });
    }
  };

  const deleteHandler = () => {
    if (
      (props.itemType === 'project' &&
        fileTree().itemMap[props.id]?.children.length > 0) ||
      props.isMultiSelected
    ) {
      props.setShowDeleteConfirmation(true);
    } else {
      deleteItem({
        itemType: props.itemType,
        id: props.id,
        itemName: props.name,
      });
    }
  };

  const openInNewTabHandler = () => {
    window.open('/app' + props.href, '_blank');
  };

  const selectedContainsProjects = props.selectedItems.some(
    (item) => item.type === 'project'
  );

  const [accessLevel] = createResource(() => {
    if (props.id === 'trash') return;
    return { itemType: props.itemType, id: props.id };
  }, getItemAccessLevel);

  const canEdit = (accessLevel: AccessLevel | undefined): boolean =>
    accessLevel === 'edit' || accessLevel === 'owner';

  return (
    <ContextMenuContent
      class={`z-item-options-menu ${isMobileWidth() && isTouchDevice ? 'w-[calc(100vw-1rem)]' : ''} ${showCreateNewSubmenu() && isMobileWidth() && isTouchDevice ? 'invisible' : ''}`}
      navId={props.id}
    >
      {/* Open in new tab */}
      <Show when={!props.isMultiSelected && !isMobileWidth() && !isTouchDevice}>
        <MenuItem
          text="Open in new tab"
          icon={ArrowsOutSimple}
          onClick={openInNewTabHandler}
        />
      </Show>
      <Show when={!props.isMultiSelected && !isMobileWidth() && !isTouchDevice}>
        <MenuSeparator />
      </Show>
      {/* Pin/Unpin */}
      <MenuItem
        text={
          props.isMultiSelected
            ? `${props.pinned ? 'Unpin' : 'Pin'} ${props.selectedItems.length} items`
            : props.pinned
              ? 'Unpin'
              : 'Pin'
        }
        icon={props.pinned ? Unpin : Pin}
        onClick={() => {
          if (props.isMultiSelected) {
            bulkTogglePin(props.selectedItems).then((result) => {
              if (result.success) {
                props.setSelectedItems([]);
              } else {
                props.setSelectedItems(result.failedItems);
              }
            });
          } else {
            togglePin({
              itemType: props.itemType,
              id: props.id,
            });
          }
        }}
      />
      {/* Copy */}
      <MenuItem
        text={
          props.isMultiSelected
            ? `Copy ${props.selectedItems.length} items`
            : 'Make a copy'
        }
        icon={CopySimple}
        onClick={() => {
          if (props.isMultiSelected) {
            bulkCopy(props.selectedItems).then((result) => {
              if (result.success) {
                props.setSelectedItems([]);
              } else {
                props.setSelectedItems(result.failedItems);
              }
            });
          } else {
            copyHandler();
          }
        }}
        disabled={
          props.itemType === 'project' ||
          (props.isMultiSelected && selectedContainsProjects)
        }
      />

      {/* Rename */}
      <Suspense
        fallback={<MenuItem text="Rename" icon={PencilSimpleLine} disabled />}
      >
        <MenuItem
          text="Rename"
          icon={PencilSimpleLine}
          onClick={props.renameHandler}
          disabled={props.isMultiSelected || !canEdit(accessLevel())}
        />
      </Suspense>
      <MenuSeparator />
      {/* Create New */}
      <Show when={props.itemType === 'project' && !props.isMultiSelected}>
        <Suspense
          fallback={<MenuItem text="Create New" icon={Plus} disabled />}
        >
          <ContextMenu.Sub
            overlap
            open={showCreateNewSubmenu()}
            onOpenChange={setShowCreateNewSubmenu}
          >
            <SubTrigger
              text="Create New"
              icon={Plus}
              disabled={!canEdit(accessLevel())}
            />
            <ContextMenu.Portal>
              <ContextMenuContent
                submenu
                class={`absolute z-action-menu ${isMobileWidth() && isTouchDevice ? 'w-[calc(100vw-1rem)] -top-20' : ''}`}
              >
                <NewItemMenuItems
                  setIsCreatingProject={props.setIsCreatingProject}
                  parentId={props.id}
                  setIsExpanded={props.setIsExpanded ?? undefined}
                />
              </ContextMenuContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
        </Suspense>
        <MenuSeparator />
      </Show>
      {/* Move to folder */}
      <Suspense
        fallback={<MenuItem text="Move to folder" icon={ArrowRight} disabled />}
      >
        <MenuItem
          text={
            props.isMultiSelected
              ? `Move ${props.selectedItems.length} items to folder`
              : 'Move to folder'
          }
          icon={ArrowRight}
          onClick={() => props.setShowMoveToFolder(true)}
          disabled={accessLevel() !== 'owner'}
        />
      </Suspense>
      <MenuSeparator />
      {/* Delete */}
      <Suspense fallback={<MenuItem text="Loading..." icon={Trash} disabled />}>
        <MenuItem
          text={
            props.isMultiSelected
              ? `${canEdit(accessLevel()) ? 'Delete' : 'Remove'} ${props.selectedItems.length} items`
              : `${canEdit(accessLevel()) ? 'Delete' : 'Remove'}`
          }
          icon={Trash}
          onClick={deleteHandler}
        />
      </Suspense>
    </ContextMenuContent>
  );
}

export function TrashItemContextMenu(props: {
  itemType: ItemType;
  id: string;
  name: string;
  selectedItems: Item[];
  setSelectedItems: (items: Item[]) => void;
  isMultiSelected: boolean;
  setShowDeleteConfirmation: (showDeleteConfirmation: boolean) => void;
}) {
  const { revertDelete, bulkRevertDelete } = useItemOperations();

  return (
    <ContextMenuContent
      class={`z-item-options-menu ${isMobileWidth() && isTouchDevice ? 'w-[calc(100vw-1rem)]' : ''}`}
    >
      {/* Restore */}
      <MenuItem
        text={
          props.isMultiSelected
            ? `Restore ${props.selectedItems.length} Selected Items`
            : 'Restore'
        }
        icon={ClockCounterClockwise}
        onClick={() => {
          if (props.isMultiSelected) {
            bulkRevertDelete(props.selectedItems).then((result) => {
              if (result.success) {
                props.setSelectedItems([]);
              } else {
                props.setSelectedItems(result.failedItems);
              }
            });
          } else {
            revertDelete({
              itemType: props.itemType,
              id: props.id,
              itemName: props.name,
            });
          }
        }}
      />
      {/* Permanently Delete */}
      <MenuItem
        text={
          props.isMultiSelected
            ? `Permanently Delete ${props.selectedItems.length} Selected Items`
            : 'Permanently Delete'
        }
        icon={Trash}
        onClick={() => props.setShowDeleteConfirmation(true)}
      />
    </ContextMenuContent>
  );
}
