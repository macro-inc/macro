import { openBulkEditModal } from '@app/component/bulk-edit-entity/BulkEditEntityModal';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { globalRemoveFromSplitHistory } from '@app/component/split-layout/layoutUtils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import type { SoupState } from '../create-soup-state';
import { restoreSoupFocus, trashEmails } from '../utils';

type MakeDeleteOptions = {
  userId: () => string | undefined;
};

export const makeDeleteAction = (options: MakeDeleteOptions) => {
  const { userId } = options;

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'channel_message') return false;
    if (entity.type === 'email') {
      return true;
    }
    if (entity.type === 'channel') {
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
    const nextRow =
      soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);

    const inPreview = previewPanel !== undefined;

    // Separate email entities from non-email entities
    const emailEntities = entities.filter((e) => e.type === 'email');
    const nonEmailEntities = entities.filter((e) => e.type !== 'email');

    const trashEmailEntities = () => {
      const handle = trashEmails(emailEntities.map((e) => e.id));

      const splitManager = globalSplitManager();
      if (splitManager) {
        const entityIdSet = new Set(emailEntities.map(({ id }) => id));
        globalRemoveFromSplitHistory(splitManager, (entry) =>
          entityIdSet.has(entry.id)
        );
      }

      soup.selection.clear();
      if (nextRow) {
        soup.focus.set(nextRow.id);
      }

      const toastId = toast.success(
        emailEntities.length > 1
          ? `Moved ${emailEntities.length} items to Trash`
          : 'Moved to Trash',
        {
          actions: [
            {
              label: 'Undo',
              icon: ArrowCounterClockwise,
              onClick: () => {
                if (toastId != null) toast.dismiss(toastId);
                handle.undo().then(
                  () => toast.success('Restored from Trash'),
                  () => toast.failure('Failed to restore from Trash')
                );
              },
            },
          ],
          duration: 10_000,
        }
      );

      // Surface background API failures
      handle.done.catch(() => {
        toast.failure('Failed to move to Trash');
      });

      restoreSoupFocus(nextRow?.id, inPreview);
    };

    if (nonEmailEntities.length > 0) {
      // Handle non-email entities first via the bulk edit modal,
      // then trash emails in onFinish so nextRow/focus are still valid.
      openBulkEditModal({
        view: 'delete',
        entities: nonEmailEntities,
        onFinish: () => {
          const splitManager = globalSplitManager();
          if (splitManager) {
            const entityIdSet = new Set(nonEmailEntities.map(({ id }) => id));
            globalRemoveFromSplitHistory(splitManager, (entry) =>
              entityIdSet.has(entry.id)
            );
          }

          toast.success(
            nonEmailEntities.length > 1
              ? `Deleted ${nonEmailEntities.length} items`
              : 'Deleted'
          );

          if (emailEntities.length > 0) {
            trashEmailEntities();
          } else {
            soup.selection.clear();
            if (nextRow) {
              soup.focus.set(nextRow.id);
            }
            restoreSoupFocus(nextRow?.id, inPreview);
          }
        },
        onCancel: () => {
          const firstEntity = nonEmailEntities[0];
          if (firstEntity) {
            soup.focus.set(firstEntity.id);
          }
          restoreSoupFocus(firstEntity?.id, inPreview);
        },
      });
    } else if (emailEntities.length > 0) {
      // Email-only selection: trash immediately
      trashEmailEntities();
    }
  };

  return { canExecute, execute, executeWithSoup };
};
