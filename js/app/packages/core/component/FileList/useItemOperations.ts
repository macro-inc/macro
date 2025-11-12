import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { ok } from '@core/util/maybeResult';
import type { ItemType } from '@service-storage/client';
import { refetchDeletedItems, useDeletedItems } from '@service-storage/deleted';
import type { Item } from '@service-storage/generated/schemas/item';
import { usePinnedIds } from '@service-storage/pins';
import {
  createCallback,
  createSingletonRoot,
} from '@solid-primitives/rootless';
import { ToastType, toast } from '../Toast/Toast';
import {
  bulkCopy as bulkCopyOp,
  bulkDelete as bulkDeleteOp,
  bulkMoveToFolder as bulkMoveToFolderOp,
  bulkPermanentlyDelete as bulkPermanentlyDeleteOp,
  bulkRename as bulkRenameOp,
  bulkRevertDelete as bulkRevertDeleteOp,
  bulkTogglePin as bulkTogglePinOp,
  copyItem as copyItemOp,
  deleteItem as deleteItemOp,
  getItemAccessLevel as getItemAccessLevelOp,
  moveToFolder as moveToFolderOp,
  permanentlyDelete as permanentlyDeleteOp,
  renameItem as renameItemOp,
  revertDelete as revertDeleteOp,
  togglePin as togglePinOp,
} from './itemOperations';

export const useItemOperations = createSingletonRoot(() => {
  const getItemAccessLevel = createCallback(
    (args: { itemType: ItemType; id: string }) => getItemAccessLevelOp(args)
  );

  const renameItem = createCallback(
    async (args: {
      itemType: ItemType;
      id: string;
      itemName: string;
      newName: string;
    }) => {
      const success = await renameItemOp({
        itemType: args.itemType,
        id: args.id,
        newName: args.newName,
      });
      if (!success) {
        toast.failure('Unable to rename item');
      }
      return success;
    }
  );

  const deleteItem = createCallback(
    async (args: { itemType: ItemType; id: string; itemName: string }) => {
      const success = await deleteItemOp(args);
      if (success) {
        toast.success(`${args.itemName} deleted`);
      } else {
        toast.failure('Unable to delete item');
      }
      return success;
    }
  );

  const moveToFolder = createCallback(
    async (args: {
      itemType: ItemType;
      id: string;
      itemName: string;
      folderId: string;
      folderName: string;
    }) => {
      const success = await moveToFolderOp(args);
      if (success) {
        toast.success(`${args.itemName} moved to ${args.folderName}`);
      } else {
        toast.failure('Unable to move item');
      }
      return success;
    }
  );

  const bulkMoveToFolder = createCallback(
    async (items: Item[], folderId: string, folderName: string) => {
      const result = await toast.promise(bulkMoveToFolderOp(items, folderId), {
        loading: `Moving ${items.length} ${items.length === 1 ? 'item' : 'items'}...`,
        success: ({ failedItems }) => {
          if (failedItems.length > 0) {
            return `Failed to move ${failedItems.length} ${failedItems.length === 1 ? 'item' : 'items'}`;
          }
          return `Successfully moved ${items.length} ${items.length === 1 ? 'item' : 'items'} to ${folderName}`;
        },
        error: (error) =>
          `Failed to move items: ${error.message || 'Unknown error'}`,
        toastTypeDeterminer: (result) =>
          result.failedItems.length > 0 ? ToastType.FAILURE : ToastType.SUCCESS,
      });
      return result;
    }
  );

  const copyItem = createCallback(
    async (args: {
      itemType: Exclude<ItemType, 'project'>;
      id: string;
      name: string;
    }) => {
      const id = await copyItemOp(args);
      const success = id !== null;
      if (success) {
        toast.success(`${args.name} copied`);
      } else {
        toast.failure('Unable to copy item');
      }
      return id;
    }
  );
  const togglePin = createCallback(
    (args: { itemType: ItemType; id: string }) => {
      if (!args.id) return toast.failure('Unable to pin item');
      return togglePinOp(args);
    }
  );

  const bulkTogglePin = createCallback(async (items: Item[]) => {
    const pinnedIds = usePinnedIds();
    const wasPinned = pinnedIds().includes(items[0].id);
    const action = wasPinned ? 'unpin' : 'pin';

    const result = await toast.promise(bulkTogglePinOp(items), {
      loading: `${wasPinned ? 'Unpinning' : 'Pinning'} ${items.length} ${items.length === 1 ? 'item' : 'items'}...`,
      success: ({ failedItems }) => {
        if (failedItems.length > 0) {
          return `Failed to ${action} ${failedItems.length} ${failedItems.length === 1 ? 'item' : 'items'}`;
        }
        return `Successfully ${action}ned ${items.length} ${items.length === 1 ? 'item' : 'items'}`;
      },
      error: (error) =>
        `Failed to ${action} items: ${error.message || 'Unknown error'}`,
      toastTypeDeterminer: (result) =>
        result.failedItems.length > 0 ? ToastType.FAILURE : ToastType.SUCCESS,
    });
    return result;
  });

  const bulkDelete = createCallback(async (items: Item[]) => {
    const result = await toast.promise(bulkDeleteOp(items), {
      loading: `Deleting ${items.length} ${items.length === 1 ? 'item' : 'items'}...`,
      success: ({ failedItems }) => {
        if (failedItems.length > 0) {
          return `Failed to delete ${failedItems.length} ${failedItems.length === 1 ? 'item' : 'items'}`;
        }
        return items.length === 5 && DEV_MODE_ENV
          ? 'PENTAKILL'
          : `Successfully deleted ${items.length} ${items.length === 1 ? 'item' : 'items'}`;
      },
      error: (error) =>
        `Failed to delete items: ${error.message || 'Unknown error'}`,
      toastTypeDeterminer: (result) =>
        result.failedItems.length > 0 ? ToastType.FAILURE : ToastType.SUCCESS,
    });
    return result;
  });

  const bulkCopy = createCallback(async (items: Item[]) => {
    const result = await toast.promise(bulkCopyOp(items), {
      loading: `Copying ${items.length} ${items.length === 1 ? 'item' : 'items'}...`,
      success: ({ failedItems }) => {
        if (failedItems.length > 0) {
          return `Failed to copy ${failedItems.length} ${failedItems.length === 1 ? 'item' : 'items'}`;
        }
        return `Successfully copied ${items.length} ${items.length === 1 ? 'item' : 'items'}`;
      },
      error: (error) =>
        `Failed to copy items: ${error.message || 'Unknown error'}`,
      toastTypeDeterminer: (result) =>
        result.failedItems.length > 0 ? ToastType.FAILURE : ToastType.SUCCESS,
    });
    return result;
  });

  const revertDelete = createCallback(
    async (args: { itemType: ItemType; id: string; itemName: string }) => {
      const success = await revertDeleteOp(args);
      if (success) {
        toast.success(`${args.itemName} restored`);
      } else {
        toast.failure('Unable to restore item');
      }
    }
  );

  const permanentlyDelete = createCallback(
    async (args: { itemType: ItemType; id: string; itemName: string }) => {
      const success = await permanentlyDeleteOp(args);
      if (success) {
        toast.success(`${args.itemName} deleted`);
      } else {
        toast.failure('Unable to delete item');
      }
    }
  );

  const bulkPermanentlyDelete = createCallback(async (items: Item[]) => {
    const result = await toast.promise(bulkPermanentlyDeleteOp(items), {
      loading: `Deleting ${items.length} ${items.length === 1 ? 'item' : 'items'}...`,
      success: ({ failedItems }) => {
        if (failedItems.length > 0) {
          return `Failed to delete ${failedItems.length} ${failedItems.length === 1 ? 'item' : 'items'}.`;
        }
        return `Successfully deleted ${items.length} ${items.length === 1 ? 'item' : 'items'}`;
      },
      error: (error) =>
        `Failed to delete items: ${error.message || 'Unknown error'}`,
      toastTypeDeterminer: (result) =>
        result.failedItems.length > 0 ? ToastType.FAILURE : ToastType.SUCCESS,
    });

    // If items have failed to permanently delete, we can't just refetch resources, because items delete so slowly everything that had been successfully deleted will reappear.
    // So we need to undo our optimistic removal here.
    if (result.failedItems.length > 0) {
      await refetchDeletedItems();
      const { deletedItems, mutate } = useDeletedItems();
      mutate(
        ok({
          items:
            deletedItems()?.filter((item) => {
              return (
                result.failedItems.some(
                  (failedItem) => failedItem.id === item.id
                ) || !items.some((argItem) => argItem.id === item.id)
              );
            }) ?? [],
        })
      );
    }

    return result;
  });

  const bulkRename = createCallback(
    async (items: { item: Item; newName: string }[]) => {
      const result = await toast.promise(bulkRenameOp(items), {
        loading: `Renaming ${items.length} ${items.length === 1 ? 'item' : 'items'}...`,
        success: ({ failedItems }) => {
          if (failedItems.length > 0) {
            return `Failed to rename ${failedItems.length} ${failedItems.length === 1 ? 'item' : 'items'}`;
          }
          return `Successfully renamed ${items.length} ${items.length === 1 ? 'item' : 'items'}`;
        },
        error: (error) =>
          `Failed to rename items: ${error.message || 'Unknown error'}`,
        toastTypeDeterminer: (result) =>
          result.failedItems.length > 0 ? ToastType.FAILURE : ToastType.SUCCESS,
      });
      return result;
    }
  );

  const bulkRevertDelete = createCallback(async (items: Item[]) => {
    const result = await toast.promise(bulkRevertDeleteOp(items), {
      loading: `Restoring ${items.length} ${items.length === 1 ? 'item' : 'items'}...`,
      success: ({ failedItems }) => {
        if (failedItems.length > 0) {
          return `Failed to restore ${failedItems.length} ${failedItems.length === 1 ? 'item' : 'items'}`;
        }
        return `Successfully restored ${items.length} ${items.length === 1 ? 'item' : 'items'}`;
      },
      error: (error) =>
        `Failed to restore items: ${error.message || 'Unknown error'}`,
      toastTypeDeterminer: (result) =>
        result.failedItems.length > 0 ? ToastType.FAILURE : ToastType.SUCCESS,
    });
    return result;
  });

  return {
    renameItem,
    deleteItem,
    moveToFolder,
    copyItem,
    togglePin,
    bulkTogglePin,
    bulkDelete,
    bulkCopy,
    bulkMoveToFolder,
    bulkRename,
    getItemAccessLevel,
    revertDelete,
    permanentlyDelete,
    bulkPermanentlyDelete,
    bulkRevertDelete,
  };
});
