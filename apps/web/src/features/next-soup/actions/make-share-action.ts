import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { openGlobalShareModal } from '@app/features/sharing/global-share-modal/GlobalShareModal';
import {
  isShareableEntity,
  isShareableEntityType,
} from '@app/features/sharing/global-share-modal/shareable-entity';
import type { EntityData } from '@entity';
import { restoreSoupFocus } from '../utils';
import type { EntityActionListState } from './entity-action-context';

/** Only the bulk dialog calls these. `ShareModal` for one row leaves the list as it is. */
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
    callbacks: BulkShareCallbacks = {}
  ) => {
    const shareable = entities.filter(isShareableEntity);
    const [first, ...others] = shareable;
    if (!first) return;

    if (others.length === 0) {
      openGlobalShareModal({ entity: first });
      return;
    }

    openBulkEditModal({ view: 'share', entities: shareable, ...callbacks });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    const focusedId = soup.focus.id();

    await execute(entities, {
      // Shared rows stay in the list, so focus stays where the user was.
      onFinish: () => {
        soup.selection.clear();
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
