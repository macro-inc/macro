import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { t } from '@app/lib/i18n';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { canEditChannelIdentity, type EntityData } from '@entity/types/entity';
import { isSessionArchived } from '@service-agent-harness/session-archive';
import { restoreSoupFocus } from '../utils';
import type { EntityActionListState } from './entity-action-context';

type MakeRenameOptions = {
  userId: () => string | undefined;
};

export const makeRenameAction = (options: MakeRenameOptions) => {
  const { userId } = options;
  const panel = useSplitPanel();

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'agent_session' && isSessionArchived(entity))
      return false;
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

  /** One row renames in place; several open the bulk rename. */
  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState
  ) => {
    const [firstEntity, ...rest] = entities;
    if (firstEntity && rest.length === 0 && panel) {
      soup.focus.set(firstEntity.id);
      panel.rowRename.begin(firstEntity);
      return;
    }

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

  return { canExecute, executeWithSoup };
};
