import { toast } from '@core/component/Toast/Toast';
import { type EntityData, isTaskEntity } from '@entity';
import {
  markNotificationsForEntityAsDone,
  type NotificationSource,
} from '@notifications';
import type { SoupState } from '../create-soup-state';
import { archiveEmail } from '@app/component/next-soup/utils';

type MakeMarkDoneOptions = {
  userId?: () => string | undefined;
  notificationSource: () => NotificationSource;
};

export const makeMarkDoneAction = (options: MakeMarkDoneOptions) => {
  const { notificationSource } = options;

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'channel_message') return false;
    if (
      entity.type === 'email' ||
      entity.type === 'channel' ||
      entity.type === 'chat' ||
      entity.type === 'document' ||
      entity.type === 'project' ||
      isTaskEntity(entity)
    ) {
      return true;
    }

    return false;
  };

  const execute = async (entities: EntityData[]) => {
    const source = notificationSource();

    await Promise.all(
      entities.map(async (entity) => {
        if (entity.type === 'email') {
          await archiveEmail(entity.id, {
            archive: true,
            optimisticallyExclude: true,
          });
        }

        markNotificationsForEntityAsDone(source, entity);
      })
    );

    toast.success(
      entities.length > 1
        ? `Marked ${entities.length} items as done`
        : 'Marked as done'
    );
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: SoupState,
    onNavigate?: (entity: EntityData) => void
  ) => {
    const currentIndex = soup.focus.index();
    const nextEntity =
      soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);

    // Run collapse animation if conditions are met (touch modality + not-done filter active)
    if (soup.collapseEntity.shouldCollapse()) {
      const collapse = soup.collapseEntity.callback();
      if (collapse) {
        await Promise.all(entities.map((entity) => collapse(entity.id)));
      }
    }

    await execute(entities);

    soup.selection.clear();

    if (nextEntity) {
      soup.focus.set(nextEntity.id);
      onNavigate?.(nextEntity);
    }
  };

  return { canExecute, execute, executeWithSoup };
};
