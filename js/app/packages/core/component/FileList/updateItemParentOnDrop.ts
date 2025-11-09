import { useUserId } from '@service-gql/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { optimisticUpdateParent } from '@service-storage/history';
import { getAllChildProjectIds } from '@service-storage/projects';
import { refetchResources } from '@service-storage/util/refetchResources';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '../SharePermissions';
import { toast } from '../Toast/Toast';
import type { DragEventWithData } from './DraggableItem';
import { useItemOperations } from './useItemOperations';

export const updateItemParentOnDrop = async (args: {
  draggable: DragEventWithData['draggable'];
  parentId: string;
  parentName: string;
}): Promise<void> => {
  const { draggable, parentId, parentName } = args;

  const { getItemAccessLevel } = useItemOperations();
  const accessLevel =
    parentId === ''
      ? 'owner'
      : await getItemAccessLevel({
          itemType: 'project',
          id: parentId,
        });

  if (!hasPermissions(getPermissions(accessLevel), Permissions.CAN_EDIT)) {
    return toast.failure(
      `You do not have permission to move items to ${parentName}`
    );
  }

  if (draggable.data.isBulkMove) {
    const items = draggable.data.selectedItems;
    if (!items) {
      return;
    }
    const failures: { item: Item; reason: string }[] = [];
    const userId = useUserId();

    await Promise.all(
      items.map(async (item) => {
        const itemParentId =
          item.type === 'project' ? item.parentId : item.projectId;
        const itemOwner =
          item.type === 'project' || item.type === 'chat'
            ? item.userId
            : item.owner;

        if (itemOwner !== userId()) {
          failures.push({ item, reason: 'You do not own this item' });
          return;
        }

        if (item.id === parentId) {
          failures.push({ item, reason: 'Cannot move item into itself' });
          return;
        }
        if (!itemParentId && !parentId) {
          failures.push({ item, reason: 'Already in root' });
          return;
        }
        if (getAllChildProjectIds(item.id).includes(parentId)) {
          failures.push({ item, reason: 'Cannot move parent into child' });
          return;
        }
        if (itemParentId === parentId) {
          failures.push({ item, reason: 'Already in destination' });
          return;
        }

        const success = await optimisticUpdateParent(
          item.type,
          item.id,
          parentId ?? ''
        );

        if (!success) {
          failures.push({ item, reason: 'Update failed' });
        }
      })
    );

    const successCount = items.length - failures.length;
    if (successCount > 0) {
      toast.success(`Moved ${successCount} items to ${parentName}`);
    }

    if (draggable.data.setSelectedItems) {
      draggable.data.setSelectedItems(() => failures.map((f) => f.item));
    }

    failures.forEach(({ item, reason }) => {
      const itemShortName =
        item.name.length < 30 ? item.name : item.name.slice(0, 27) + '...';
      toast.failure(`Failed to move "${itemShortName}": ${reason}`);
    });
  } else {
    // Draggable data
    const itemType = draggable.data.type;
    const itemId = draggable.data.id;
    const itemParentId = draggable.data.parentId
      ? String(draggable.data.parentId)
      : undefined;
    const itemShortName =
      draggable.data.name.length < 30
        ? draggable.data.name
        : draggable.data.name.slice(0, 27) + '...';

    // Droppable data
    const parentShortName =
      parentName.length < 30 ? parentName : parentName.slice(0, 27) + '...';

    const dragChildren = getAllChildProjectIds(itemId);

    if (itemId === parentId) {
      return;
    }

    if (!itemParentId && !parentId) {
      return;
    }

    if (dragChildren.includes(parentId)) {
      return toast.failure(
        `${parentShortName} is contained by ${itemShortName}. Can not move here.`
      );
    }

    if (itemParentId === parentId) {
      return;
    }

    // TODO: update this with correct permissions when we have project sharing
    if (draggable.data.isOwner !== true) {
      return toast.failure(
        `You do not own ${itemShortName}, it can not be moved`
      );
    }

    if (await optimisticUpdateParent(itemType, itemId, parentId ?? '')) {
      toast.success(`Moved "${itemShortName}" to ${parentShortName}`);
    } else {
      toast.failure(`Could not move "${itemShortName}"`);
    }
  }

  refetchResources();
};
