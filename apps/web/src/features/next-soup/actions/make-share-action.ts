import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { openGlobalShareModal } from '@app/features/sharing/global-share-modal/GlobalShareModal';
import {
  isShareableEntity,
  isShareableEntityType,
} from '@app/features/sharing/global-share-modal/shareable-entity';
import type { EntityData } from '@entity';
import { restoreSoupFocus } from '../utils';
import type { EntityActionListState } from './entity-action-context';

type BulkShareCallbacks = { onFinish?: () => void; onCancel?: () => void };

export const makeShareAction = () => {
  /**
   * Check if the share action can be executed
   * Only requires shareable type - the modal handles permissions
   */
  const canExecute = (entity: EntityData): boolean => {
    return isShareableEntityType(entity.type);
  };

  const execute = async (
    entities: EntityData[],
    bulk: BulkShareCallbacks = {}
  ) => {
    const shareable = entities.filter(isShareableEntity);
    const [first, ...others] = shareable;
    if (!first) return;

    if (others.length === 0) {
      openGlobalShareModal({ entity: first });
      return;
    }

    openBulkEditModal({ view: 'share', entities: shareable, ...bulk });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    const focusedId = soup.focus.id();

    await execute(entities, {
      onFinish: () => {
        soup.selection.clear();
        if (focusedId) {
          soup.focus.set(focusedId);
        }
        void restoreSoupFocus(focusedId);
      },
      onCancel: () => {
        const firstEntity = entities[0];
        if (firstEntity) {
          soup.focus.set(firstEntity.id);
        }
        void restoreSoupFocus(firstEntity?.id);
      },
    });
  };

  return { canExecute, execute, executeWithSoup };
};
