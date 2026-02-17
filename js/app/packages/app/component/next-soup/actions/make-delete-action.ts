import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { openBulkEditModal } from '@app/component/bulk-edit-entity/BulkEditEntityModal';
import { globalSplitManager } from '@app/signal/splitLayout';
import { globalRemoveFromSplitHistory } from '@app/component/split-layout/layoutUtils';
import type { SoupState } from '../create-soup-state';
import { restoreSoupFocus } from '../utils';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';

type MakeDeleteOptions = {
  userId: () => string | undefined;
};

export const makeDeleteAction = (options: MakeDeleteOptions) => {
  const { userId } = options;

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'channel' || entity.type === 'email') {
      return false;
    }
    return entity.ownerId === userId();
  };

  const execute = async (entities: EntityData[]) => {
    openBulkEditModal({
      view: 'delete',
      entities,
      onFinish: () => {
        const splitManager = globalSplitManager();
        if (splitManager) {
          const entityIdSet = new Set(entities.map(({ id }) => id));
          globalRemoveFromSplitHistory(splitManager, (entry) =>
            entityIdSet.has(entry.id)
          );
        }
        toast.success(
          entities.length > 1 ? `Deleted ${entities.length} items` : 'Deleted'
        );
      },
    });
  };

  const previewPanel = useMaybePreviewPanel();

  const executeWithSoup = async (entities: EntityData[], soup: SoupState) => {
    const currentIndex = soup.focus.index();
    const nextEntity =
      soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);

    const inPreview = previewPanel !== undefined;

    openBulkEditModal({
      view: 'delete',
      entities,
      onFinish: () => {
        const splitManager = globalSplitManager();
        if (splitManager) {
          const entityIdSet = new Set(entities.map(({ id }) => id));
          globalRemoveFromSplitHistory(splitManager, (entry) =>
            entityIdSet.has(entry.id)
          );
        }

        soup.selection.clear();
        if (nextEntity) {
          soup.focus.set(nextEntity.id);
        }

        toast.success(
          entities.length > 1 ? `Deleted ${entities.length} items` : 'Deleted'
        );

        restoreSoupFocus(nextEntity?.id, inPreview);
      },
      onCancel: () => {
        const firstEntity = entities[0];
        if (firstEntity) {
          soup.focus.set(firstEntity.id);
        }
        restoreSoupFocus(firstEntity?.id, inPreview);
      },
    });
  };

  return { canExecute, execute, executeWithSoup };
};
