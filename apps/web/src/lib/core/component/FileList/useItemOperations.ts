import { t } from '@app/lib/i18n';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import type { ItemType } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import {
  createCallback,
  createSingletonRoot,
} from '@solid-primitives/rootless';
import { ToastType, toast } from '../Toast/Toast';
import {
  bulkDelete as bulkDeleteOp,
  bulkPermanentlyDelete as bulkPermanentlyDeleteOp,
  bulkRevertDelete as bulkRevertDeleteOp,
  copyItem as copyItemOp,
  deleteItem as deleteItemOp,
  getItemAccessLevel as getItemAccessLevelOp,
  permanentlyDelete as permanentlyDeleteOp,
  revertDelete as revertDeleteOp,
} from './itemOperations';

export const useItemOperations = createSingletonRoot(() => {
  const getItemAccessLevel = createCallback(
    (args: { itemType: ItemType; id: string }) => getItemAccessLevelOp(args)
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

  const copyItem = createCallback(
    async (args: { itemType: ItemType; id: string; name: string }) => {
      const id = await copyItemOp(args);
      const success = id !== null;
      if (success) {
        toast.success(`${args.name} copied`);
      } else if (args.itemType === 'project') {
        toast.failure(t('entityActions.toastDuplicateFolderFailed'), {
          subtext: t('entityActions.folderDuplicateLimitHint'),
        });
      } else {
        toast.failure(t('entityActions.toastCopyFailed', { count: 1 }));
      }
      return id;
    }
  );
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

    return result;
  });

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
    deleteItem,
    copyItem,
    bulkDelete,
    getItemAccessLevel,
    revertDelete,
    permanentlyDelete,
    bulkPermanentlyDelete,
    bulkRevertDelete,
  };
});
