import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';
import { restoreSoupFocus } from '../utils';

type MakeRenameOptions = {
  userId: () => string | undefined;
};

export const makeRenameAction = (options: MakeRenameOptions) => {
  const { userId } = options;

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'email') return false;
    if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
      return false;
    }
    if (entity.type === 'foreign') return false;

    if (entity.type === 'channel') {
      if (entity.channelType === 'direct_message') return false;
      return entity.ownerId === userId();
    }

    return entity.ownerId === userId();
  };

  const execute = async (entities: EntityData[]) => {
    openBulkEditModal({
      view: 'rename',
      entities,
      onFinish: () => {
        toast.success(
          entities.length > 1 ? `Renamed ${entities.length} items` : 'Renamed'
        );
      },
    });
  };

  const executeWithSoup = async (entities: EntityData[], soup: SoupState) => {
    const firstEntity = entities[0];

    openBulkEditModal({
      view: 'rename',
      entities,
      onFinish: () => {
        toast.success(
          entities.length > 1 ? `Renamed ${entities.length} items` : 'Renamed'
        );
        if (firstEntity) {
          soup.focus.set(firstEntity.id);
        }
        restoreSoupFocus(firstEntity?.id);
      },
      onCancel: () => {
        if (firstEntity) {
          soup.focus.set(firstEntity.id);
        }
        restoreSoupFocus(firstEntity?.id);
      },
    });
  };

  return { canExecute, execute, executeWithSoup };
};
