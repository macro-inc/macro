import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { openBulkEditModal } from '@app/component/bulk-edit-entity/BulkEditEntityModal';
import type { SoupState } from '../create-soup-state';
import { restoreSoupFocus } from '../utils';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';

export const makeMoveToProjectAction = () => {
  const canExecute = (entity: EntityData): boolean => {
    return entity.type !== 'channel';
  };

  const execute = async (entities: EntityData[]) => {
    openBulkEditModal({
      view: 'moveToProject',
      entities,
      onFinish: () => {
        toast.success(
          entities.length > 1
            ? `Moved ${entities.length} items`
            : 'Moved to folder'
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
      view: 'moveToProject',
      entities,
      onFinish: () => {
        soup.selection.clear();
        if (nextEntity) {
          soup.focus.set(nextEntity.id);
        }
        toast.success(
          entities.length > 1
            ? `Moved ${entities.length} items`
            : 'Moved to folder'
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
