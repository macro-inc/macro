import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import { restoreSoupFocus } from '../utils';
import type { EntityActionListState } from './entity-action-context';

export const makeMoveToProjectAction = () => {
  const canExecute = (entity: EntityData): boolean => {
    return (
      entity.type !== 'database' &&
      entity.type !== 'form' &&
      entity.type !== 'agent_session' &&
      entity.type !== 'channel' &&
      entity.type !== 'channel_message' &&
      entity.type !== 'channel_thread' &&
      entity.type !== 'foreign'
    );
  };

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

  return { canExecute, execute, executeWithSoup };
};
