// packages/block-project/component/SelectionAction.tsx
import { IconButton } from '@core/component/IconButton';
import { TextButton } from '@core/component/TextButton';
import CopyIcon from '@icon/regular/copy.svg?component-solid';
import TrashIcon from '@icon/regular/trash.svg?component-solid';
import XIcon from '@icon/regular/x.svg?component-solid';
import { Dialog } from '@kobalte/core/dialog';
import type { Item } from '@service-storage/generated/schemas/item';
import { toast } from 'core/component/Toast/Toast';
import { type Accessor, createSignal, type Setter } from 'solid-js';

interface SelectionActionProps {
  selectedItems: Accessor<Item[]>;
  setSelectedItems: Setter<Item[]>;
  onDelete?: () => Promise<{ success: boolean; failedItems: Item[] }>;
  onCopy?: () => Promise<{ success: boolean; failedItems: Item[] }>;
  onMoveToFolder?: (
    folderId: string,
    folderName: string
  ) => Promise<{ success: boolean; failedItems: Item[] }>;
}

export function SelectionAction(props: SelectionActionProps) {
  const [deleteConfirmVisible, setDeleteConfirmVisible] = createSignal(false);

  const clearSelection = () => {
    props.setSelectedItems([]);
  };

  const handleDelete = async () => {
    setDeleteConfirmVisible(false);
    if (props.onDelete) {
      const { success, failedItems } = await props.onDelete();
      if (success) {
        props.setSelectedItems([]);
      } else {
        // Keep only the failed items selected
        props.setSelectedItems(failedItems);
      }
    }
  };

  const handleCopy = async () => {
    if (props.onCopy) {
      // Check if any selected items are projects
      if (props.selectedItems().some((item) => item.type === 'project')) {
        toast.failure('Projects cannot be copied');
        return;
      }

      const { success, failedItems } = await props.onCopy();
      if (success) {
        props.setSelectedItems([]);
      } else {
        // Keep only the failed items selected
        props.setSelectedItems(failedItems);
      }
    }
  };

  // const handleMoveToFolder = async () => {
  //   if (props.onMoveToFolder) {
  //     const { success, failedItems } = await props.onMoveToFolder();
  //     if (success) {
  //       props.setSelectedItems([]);
  //     } else {
  //       // Keep only the failed items selected
  //       props.setSelectedItems(failedItems);
  //     }
  //   }
  // };

  const deleteConfirmationText = () => {
    const count = props.selectedItems().length;
    const projectCount = props
      .selectedItems()
      .filter((item) => item.type === 'project').length;

    // This is digusting and should be destroyed
    if (projectCount > 0) {
      return `Are you sure you want to delete <b>${count} ${projectCount === count ? (projectCount === 1 ? 'folder' : 'folders') : count === 1 ? 'item' : 'items'}${projectCount !== count ? `, including ${projectCount} ${projectCount === 1 ? 'folder' : 'folders'}` : ''} and all of ${projectCount === 1 ? 'its' : 'their'} contents</b>?`;
    }

    return `Are you sure you want to delete <b>${count} ${count === 1 ? 'item' : 'items'}</b>? This action cannot be undone.`;
  };

  return (
    <>
      <div class="rounded-full h-15 mx-4 px-2 py-2 flex items-center gap-6 bg-accent/10 text-ink">
        <div class="flex items-center gap-2">
          <IconButton
            icon={XIcon}
            theme="clear"
            onClick={clearSelection}
            tooltip={{ label: 'Clear selection' }}
          />
          <span class="text-sm font-medium text-ink">
            {props.selectedItems().length} item
            {props.selectedItems().length !== 1 ? 's' : ''} selected
          </span>
        </div>
        <div class="flex items-center gap-2">
          <IconButton
            icon={CopyIcon}
            theme={
              props.selectedItems().some((item) => item.type === 'project')
                ? 'disabled'
                : 'base'
            }
            onClick={handleCopy}
            tooltip={{
              label: props
                .selectedItems()
                .some((item) => item.type === 'project')
                ? 'Can not duplicate projects'
                : 'Duplicate selected items',
            }}
          />
          <IconButton
            icon={TrashIcon}
            theme="red"
            onClick={() => setDeleteConfirmVisible(true)}
            tooltip={{ label: 'Delete selected items' }}
          />
          {/* <IconButton
            icon={MoveToFolderIcon}
            theme="light"
            onClick={handleMoveToFolder}
            tooltip={{ label: 'Move to folder' }}
          /> */}
        </div>
      </div>

      <Dialog
        open={deleteConfirmVisible()}
        onOpenChange={setDeleteConfirmVisible}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed flex inset-0 z-modal bg-modal-overlay items-center justify-content" />
          <Dialog.Content class="fixed left-1/2 top-1/2 z-modal -translate-x-1/2 -translate-y-1/2 bg-dialog rounded-xl p-4 shadow-lg w-80">
            <Dialog.Title class="font-bold mb-2 text-ink">
              Delete Items?
            </Dialog.Title>
            <Dialog.Description
              class="text-sm text-ink mb-4"
              innerHTML={deleteConfirmationText()}
            />

            <div class="flex justify-end gap-3 mt-4">
              <Dialog.CloseButton>
                <TextButton text="Cancel" theme="clear" />
              </Dialog.CloseButton>
              <TextButton text="Delete" theme="red" onClick={handleDelete} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  );
}
