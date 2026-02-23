import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';
import {
  isShareableEntityType,
  openGlobalShareModal,
} from '@app/component/global-share-modal/GlobalShareModal';

type MakeShareOptions = {
  userId: () => string | undefined;
};

export const makeShareAction = (options: MakeShareOptions) => {
  const { userId } = options;

  /**
   * Check if the share action can be executed
   * Requires shareable type AND ownership
   */
  const canExecute = (entity: EntityData): boolean => {
    // Can only share entities of shareable types
    if (!isShareableEntityType(entity.type)) {
      return false;
    }

    // Only owners can share
    return entity.ownerId === userId();
  };

  const execute = async (entities: EntityData[], currentUserId?: string) => {
    // Share only works on single entity
    const entity = entities[0];
    if (!entity) return;

    if (!isShareableEntityType(entity.type)) {
      toast.alert('Cannot share this item type');
      return;
    }

    if (entity.ownerId !== currentUserId) {
      toast.alert('Only the owner can share this item');
      return;
    }

    openGlobalShareModal({
      entity,
    });
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities, userId());
    // Don't clear selection or change focus for share
  };

  return { canExecute, execute, executeWithSoup };
};
