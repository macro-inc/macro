import { usePaywallState } from '@core/constant/PaywallState';
import { isPaymentError } from '@core/util/handlePaymentError';
import { isErr, isOk } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import {
  optimisticallyRemoveDeletedItem,
  useDeletedTree,
} from '@service-storage/deleted';
import type { Item } from '@service-storage/generated/schemas/item';
import { removeHistoryItem } from '@service-storage/history';
import { pinItem, unpinItem, usePinnedIds } from '@service-storage/pins';
import { refetchResources } from '@service-storage/util/refetchResources';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '../SharePermissions';

const DEFAULT_CHUNK_SIZE = 10;

export async function getItemAccessLevel({
  itemType,
  id,
}: {
  itemType: ItemType;
  id: string;
}) {
  switch (itemType) {
    case 'project':
      const maybeProjectMetadata =
        await storageServiceClient.projects.getProject({
          id,
        });
      if (isOk(maybeProjectMetadata)) {
        return maybeProjectMetadata[1].userAccessLevel;
      }
      break;

    case 'document':
      const maybeDocumentMetadata =
        await storageServiceClient.getDocumentMetadata({
          documentId: id,
        });
      if (isOk(maybeDocumentMetadata)) {
        return maybeDocumentMetadata[1].userAccessLevel;
      }
      break;

    case 'chat':
      const maybeChatMetadata = await cognitionApiServiceClient.getChat({
        chat_id: id,
      });
      if (isOk(maybeChatMetadata)) {
        return maybeChatMetadata[1].userAccessLevel;
      }
      break;
    default:
      return;
  }
}

export async function renameItem(args: {
  itemType: ItemType;
  id: string;
  newName: string;
  skipRefetch?: boolean;
}): Promise<boolean> {
  const { itemType, id, newName, skipRefetch = false } = args;
  console.log('RENAMING ITEM', args);

  let result;

  switch (itemType) {
    case 'document': {
      result = await storageServiceClient.editDocument({
        documentId: id,
        documentName: newName,
      });
      break;
    }
    case 'project': {
      result = await storageServiceClient.projects.edit({
        id,
        name: newName,
      });
      break;
    }
    case 'chat': {
      result = await cognitionApiServiceClient.renameChat({
        chat_id: id,
        new_name: newName,
      });
      break;
    }
    default: {
      return false;
    }
  }

  if (isErr(result)) {
    return false;
  }

  if (!skipRefetch) {
    refetchResources();
  }
  return true;
}

export async function deleteItem(args: {
  itemType: ItemType;
  id: string;
}): Promise<boolean> {
  const { itemType, id } = args;

  const accessLevel = await getItemAccessLevel({ itemType, id });

  if (accessLevel === 'owner') {
    let result;
    switch (itemType) {
      case 'document': {
        result = await storageServiceClient.deleteDocument({
          documentId: id,
        });
        break;
      }
      case 'project': {
        result = await storageServiceClient.projects.delete({
          id,
        });
        break;
      }
      case 'chat': {
        result = await cognitionApiServiceClient.deleteChat({
          chat_id: id,
        });
        break;
      }
      default: {
        return false;
      }
    }
    if (isErr(result)) {
      return false;
    }
  } else {
    if (itemType === 'channel') return false;
    if (itemType === 'email') return false;
    const removed = await removeHistoryItem(itemType, id);
    if (!removed) return false;
  }

  refetchResources();
  return true;
}

export async function bulkDelete(
  selectedItems: Item[],
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ success: boolean; failedItems: Item[] }> {
  const failedItems: Item[] = [];

  for (let i = 0; i < selectedItems.length; i += chunkSize) {
    const chunk = selectedItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((item) =>
        deleteItem({
          itemType: item.type,
          id: item.id,
        })
      )
    );

    results.forEach((result, index) => {
      if (
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && !result.value)
      ) {
        failedItems.push(chunk[index]);
      }
    });
  }

  return {
    success: failedItems.length === 0,
    failedItems,
  };
}

export async function bulkRename(
  selectedItems: { item: Item; newName: string }[],
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ success: boolean; failedItems: Item[] }> {
  console.log('bulk rename', selectedItems);
  const failedItems: Item[] = [];

  for (let i = 0; i < selectedItems.length; i += chunkSize) {
    const chunk = selectedItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map(({ item, newName }) =>
        renameItem({
          itemType: item.type,
          id: item.id,
          newName,
          skipRefetch: true,
        })
      )
    );

    results.forEach((result, index) => {
      if (
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && !result.value)
      ) {
        failedItems.push(chunk[index].item);
      }
    });
  }

  refetchResources();
  return {
    success: failedItems.length === 0,
    failedItems,
  };
}

export async function moveToFolder(args: {
  itemType: ItemType;
  id: string;
  folderId: string;
}): Promise<boolean> {
  const { itemType, id, folderId } = args;
  const accessLevel = await getItemAccessLevel({ itemType, id });
  if (!accessLevel) return false;
  if (!hasPermissions(getPermissions(accessLevel), Permissions.CAN_EDIT))
    return false;

  let result;
  switch (itemType) {
    case 'document': {
      result = await storageServiceClient.editDocument({
        documentId: id,
        projectId: folderId,
      });
      break;
    }
    case 'project': {
      result = await storageServiceClient.projects.edit({
        id,
        projectParentId: folderId,
      });
      break;
    }
    case 'chat': {
      result = await cognitionApiServiceClient.editChatProject({
        chat_id: id,
        project_id: folderId,
      });
      break;
    }
    default: {
      return false;
    }
  }

  if (isErr(result)) {
    return false;
  }
  refetchResources();
  return true;
}

export async function bulkMoveToFolder(
  selectedItems: Item[],
  folderId: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ success: boolean; failedItems: Item[] }> {
  const failedItems: Item[] = [];

  // Process items in chunks
  for (let i = 0; i < selectedItems.length; i += chunkSize) {
    const chunk = selectedItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((item) =>
        moveToFolder({
          itemType: item.type,
          id: item.id,
          folderId,
        })
      )
    );

    // Process results for this chunk
    results.forEach((result, index) => {
      if (
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && !result.value)
      ) {
        failedItems.push(chunk[index]);
      }
    });
  }

  return {
    success: failedItems.length === 0,
    failedItems,
  };
}

/**
 * Note: Currently we do not support copying projects.
 */
export async function copyItem(args: {
  itemType: Exclude<ItemType, 'project'>;
  id: string;
  name: string;
}): Promise<string | null> {
  const { itemType, id, name } = args;
  const { showPaywall } = usePaywallState();

  let newId = '';
  switch (itemType) {
    case 'document': {
      const result = await storageServiceClient.copyDocument({
        documentId: id,
        documentName: `${name} copy`,
      });
      if (isErr(result)) return null;
      newId = result[1].documentId;
      break;
    }
    case 'chat': {
      const result = await cognitionApiServiceClient.copyChat({
        chat_id: id,
        name,
      });
      if (isPaymentError(result)) {
        showPaywall();
      }
      if (isErr(result)) {
        return null;
      }
      newId = result[1].id;
      break;
    }
    default:
      return null;
  }

  refetchResources();
  return newId;
}

export async function bulkCopy(
  selectedItems: Item[],
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ success: boolean; failedItems: Item[] }> {
  const failedItems: Item[] = [];

  // Process items in chunks
  for (let i = 0; i < selectedItems.length; i += chunkSize) {
    const chunk = selectedItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((item) =>
        copyItem({
          itemType: item.type as Exclude<ItemType, 'project'>,
          id: item.id,
          name: item.name,
        })
      )
    );

    // Process results for this chunk
    results.forEach((result, index) => {
      if (
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && !result.value)
      ) {
        failedItems.push(chunk[index]);
      }
    });
  }

  return {
    success: failedItems.length === 0,
    failedItems,
  };
}

export async function togglePin(args: {
  itemType: ItemType;
  id: string;
}): Promise<boolean> {
  const { itemType, id } = args;
  const pinnedIds = usePinnedIds();
  const pinned = pinnedIds().includes(id);

  if (pinned) {
    return unpinItem(itemType, id);
  } else {
    return pinItem(itemType, id);
  }
}

export async function bulkTogglePin(
  selectedItems: Item[],
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ success: boolean; failedItems: Item[] }> {
  const pinnedIds = usePinnedIds();
  // Check if all items have the same pinned state
  const allItemsHaveSameState = selectedItems.every(
    (item) =>
      pinnedIds().includes(item.id) ===
      pinnedIds().includes(selectedItems[0].id)
  );
  if (!allItemsHaveSameState) {
    return {
      success: false,
      failedItems: selectedItems,
    };
  }

  const failedItems: Item[] = [];

  // Process items in chunks
  for (let i = 0; i < selectedItems.length; i += chunkSize) {
    const chunk = selectedItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((item) =>
        togglePin({
          itemType: item.type,
          id: item.id,
        })
      )
    );

    // Process results for this chunk
    results.forEach((result, index) => {
      if (
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && !result.value)
      ) {
        failedItems.push(chunk[index]);
      }
    });
  }

  return {
    success: failedItems.length === 0,
    failedItems,
  };
}

export async function revertDelete(args: {
  itemType: ItemType;
  id: string;
}): Promise<boolean> {
  const { itemType, id } = args;

  let result;

  switch (itemType) {
    case 'document': {
      result = await storageServiceClient.revertDocumentDelete({
        documentId: id,
      });
      break;
    }
    case 'project': {
      result = await storageServiceClient.projects.revertDelete({
        id,
      });
      break;
    }
    case 'chat': {
      result = await cognitionApiServiceClient.revertDeleteChat({
        chat_id: id,
      });
      break;
    }
    default: {
      return false;
    }
  }

  if (isErr(result)) {
    return false;
  }

  refetchResources();
  return true;
}

export async function permanentlyDelete(args: {
  itemType: ItemType;
  id: string;
}): Promise<boolean> {
  const { itemType, id } = args;

  let result;
  switch (itemType) {
    case 'document': {
      optimisticallyRemoveDeletedItem(id);
      result = await storageServiceClient.permanentlyDeleteDocument({
        documentId: id,
      });
      break;
    }
    case 'project': {
      const deleteTree = useDeletedTree();
      const findAllDescendants = (projectId: string): string[] => {
        const descendantIds: string[] = [];
        const node = deleteTree().itemMap[projectId];
        if (node && node.children) {
          node.children.forEach((child) => {
            descendantIds.push(child.id);
            descendantIds.push(...findAllDescendants(child.id));
          });
        }
        return descendantIds;
      };

      const descendantIds = findAllDescendants(id);
      descendantIds.forEach((descendantId) => {
        optimisticallyRemoveDeletedItem(descendantId);
      });
      optimisticallyRemoveDeletedItem(id);

      result = await storageServiceClient.projects.permanentlyDelete({
        id,
      });
      break;
    }
    case 'chat': {
      optimisticallyRemoveDeletedItem(id);
      result = await cognitionApiServiceClient.permanentlyDeleteChat({
        chat_id: id,
      });
      break;
    }
    default: {
      return false;
    }
  }

  if (isErr(result)) {
    return false;
  }

  return true;
}

export async function bulkPermanentlyDelete(
  selectedItems: Item[],
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ success: boolean; failedItems: Item[] }> {
  const failedItems: Item[] = [];

  const selectedItemIds = new Set(selectedItems.map((item) => item.id));
  const deleteTree = useDeletedTree();

  const descendants: Item[] = [];

  const eldestItemsOnly = selectedItems.filter((item) => {
    const getParentId = (item: Item) => {
      return item.type === 'project' ? item.parentId : item.projectId;
    };

    let currentItem = item;
    while (currentItem) {
      const parentId = getParentId(currentItem);
      if (!parentId || !deleteTree().itemMap[parentId]?.item) break;

      if (selectedItemIds.has(parentId)) {
        descendants.push(item);
        return false;
      }

      currentItem = deleteTree().itemMap[parentId]?.item;
      if (!currentItem) break;
    }

    return true;
  });

  // Descendants need to be optimistically removed from history tree
  descendants.forEach((item) => {
    optimisticallyRemoveDeletedItem(item.id);
  });

  for (let i = 0; i < eldestItemsOnly.length; i += chunkSize) {
    const chunk = selectedItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((item) =>
        permanentlyDelete({
          itemType: item.type,
          id: item.id,
        })
      )
    );

    // Reverse of above, we need to push not only failed items, but also any of their descendants in selectedItems to failedItems
    results.forEach((result, index) => {
      if (
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && !result.value)
      ) {
        const failedItem = chunk[index];
        failedItems.push(failedItem);

        const findChildren = (item: Item): Item[] => {
          const children: Item[] = [];
          const node = deleteTree().itemMap[item.id];
          if (!node) return children;

          node.children.forEach((child) => {
            if (selectedItemIds.has(child.id)) {
              children.push(child);
              children.push(...findChildren(child));
            }
          });

          return children;
        };

        failedItems.push(...findChildren(failedItem));
      }
    });
  }

  return {
    success: failedItems.length === 0,
    failedItems,
  };
}

export async function bulkRevertDelete(
  selectedItems: Item[],
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ success: boolean; failedItems: Item[] }> {
  const failedItems: Item[] = [];

  // Process items in chunks
  for (let i = 0; i < selectedItems.length; i += chunkSize) {
    const chunk = selectedItems.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((item) =>
        revertDelete({
          itemType: item.type,
          id: item.id,
        })
      )
    );

    // Process results for this chunk
    results.forEach((result, index) => {
      if (
        result.status === 'rejected' ||
        (result.status === 'fulfilled' && !result.value)
      ) {
        failedItems.push(chunk[index]);
      }
    });
  }

  return {
    success: failedItems.length === 0,
    failedItems,
  };
}
