import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';
import {
  isShareableEntityType,
  openGlobalShareModal,
} from '@app/component/global-share-modal/GlobalShareModal';

export const makeShareAction = () => {
  /**
   * Check if the share action can be executed
   * Only requires shareable type - the modal handles permissions
   */
  const canExecute = (entity: EntityData): boolean => {
    return isShareableEntityType(entity.type);
  };

  const execute = async (entity: EntityData) => {
    if (!isShareableEntityType(entity.type)) {
      return;
    }

    openGlobalShareModal({
      entity,
    });
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    const entity = entities[0];
    if (!entity) return;

    await execute(entity);
    // Don't clear selection or change focus for share
  };

  return { canExecute, execute, executeWithSoup };
};
