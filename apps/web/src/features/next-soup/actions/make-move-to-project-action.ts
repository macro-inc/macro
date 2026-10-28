import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import { restoreSoupFocus } from '../utils';
import type { EntityActionListState } from './entity-action-context';

type MakeMoveToProjectOptions = {
  userId: () => string | undefined;
};

/**
 * Move items into a folder. Only an item's owner may: a folder is one
 * location shared by everyone, and its sharing passes to what it holds, so
 * a move changes where the owner finds the item and who can see it.
 */
export const makeMoveToProjectAction = (options: MakeMoveToProjectOptions) => {
  // The types the move mutation supports; it rejects any other.
  const canMoveType = (entity: EntityData): boolean =>
    entity.type === 'document' ||
    entity.type === 'chat' ||
    entity.type === 'project' ||
    entity.type === 'email';

  const canExecute = (entity: EntityData): boolean =>
    canMoveType(entity) && entity.ownerId === options.userId();

  const execute = async (entities: EntityData[]) => {
    openBulkEditModal({
      view: 'moveToProject',
      entities,
      onFinish: () => {
        toast.success(
          entities.length > 1
            ? t('entityActions.toastMovedCount', { count: entities.length })
            : t('entityActions.toastMovedToFolder')
        );
      },
      onError: () => toast.failure(t('entityActions.toastMoveToFolderFailed')),
    });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    const currentIndex = soup.focus.index();
    const nextRow =
      soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);

    openBulkEditModal({
      view: 'moveToProject',
      entities,
      onFinish: () => {
        soup.selection.clear();
        if (nextRow) {
          soup.focus.set(nextRow.id);
        }
        toast.success(
          entities.length > 1
            ? t('entityActions.toastMovedCount', { count: entities.length })
            : t('entityActions.toastMovedToFolder')
        );
        fireAndForget(restoreSoupFocus(nextRow?.id), 'entity-actions');
      },
      onError: () => toast.failure(t('entityActions.toastMoveToFolderFailed')),
      onCancel: () => {
        const firstEntity = entities[0];
        if (firstEntity) {
          soup.focus.set(firstEntity.id);
        }
        fireAndForget(restoreSoupFocus(firstEntity?.id), 'entity-actions');
      },
    });
  };

  return { canMoveType, canExecute, execute, executeWithSoup };
};
