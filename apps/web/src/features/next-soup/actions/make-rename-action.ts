import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { canEditChannelIdentity, type EntityData } from '@entity/types/entity';
import { restoreSoupFocus } from '../utils';
import type { EntityActionListState } from './entity-action-context';

type MakeRenameOptions = {
  userId: () => string | undefined;
};

export const makeRenameAction = (options: MakeRenameOptions) => {
  const { userId } = options;

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'agent_session' && entity.isArchived) return false;
    if (entity.type === 'database') {
      return entity.grant === 'edit' || entity.grant === 'owner';
    }
    if (entity.type === 'channel') return canEditChannelIdentity(entity);
    // The types the rename mutation supports; it rejects any other.
    if (
      entity.type !== 'agent_session' &&
      entity.type !== 'document' &&
      entity.type !== 'chat' &&
      entity.type !== 'project' &&
      entity.type !== 'call'
    )
      return false;

    return entity.ownerId === userId();
  };

  const execute = async (entities: EntityData[]) => {
    openBulkEditModal({
      view: 'rename',
      entities,
      onFinish: () => {
        toast.success(
          entities.length > 1
            ? t('entityActions.toastRenamedCount', { count: entities.length })
            : t('entityActions.toastRenamed')
        );
      },
    });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    const firstEntity = entities[0];

    openBulkEditModal({
      view: 'rename',
      entities,
      onFinish: () => {
        toast.success(
          entities.length > 1
            ? t('entityActions.toastRenamedCount', { count: entities.length })
            : t('entityActions.toastRenamed')
        );
        if (firstEntity) {
          soup.focus.set(firstEntity.id);
        }
        fireAndForget(restoreSoupFocus(firstEntity?.id), 'entity-actions');
      },
      onCancel: () => {
        if (firstEntity) {
          soup.focus.set(firstEntity.id);
        }
        fireAndForget(restoreSoupFocus(firstEntity?.id), 'entity-actions');
      },
    });
  };

  return { canExecute, execute, executeWithSoup };
};
