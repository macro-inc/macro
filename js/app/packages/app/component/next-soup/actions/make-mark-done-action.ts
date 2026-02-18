import { toast } from '@core/component/Toast/Toast';
import {
  type EntityData,
  isCurrentUserAssigned,
  isTaskClosed,
  isTaskEntity,
  type TaskEntityWithProperties,
} from '@entity';
import {
  markNotificationsForEntityAsDone,
  type NotificationSource,
} from '@notifications';
import { useSetPropertyStatusCompleteMutation } from '@queries/properties/entity';
import type { PropertiesEntityType } from '@service-properties/client';
import type { SoupState } from '../create-soup-state';
import { archiveEmail } from '@app/component/next-soup/utils';

type MakeMarkDoneOptions = {
  userId: () => string | undefined;
  notificationSource: () => NotificationSource;
};

const getPropertiesEntityType = (
  entity: EntityData
): PropertiesEntityType | undefined => {
  if (isTaskEntity(entity)) return 'TASK';
  if (entity.type === 'email') return 'THREAD';
  if (entity.type === 'document') return 'DOCUMENT';
  if (entity.type === 'project') return 'PROJECT';
  return undefined;
};

export const makeMarkDoneAction = (options: MakeMarkDoneOptions) => {
  const { userId, notificationSource } = options;

  const setPropertyStatusCompleteMutation =
    useSetPropertyStatusCompleteMutation();

  const canExecute = (entity: EntityData): boolean => {
    if (entity.type === 'email' || entity.type === 'channel') {
      return true;
    }

    if (isTaskEntity(entity)) {
      const currentUserId = userId();
      if (
        !isCurrentUserAssigned(
          entity as TaskEntityWithProperties,
          currentUserId
        )
      ) {
        return false;
      }
      if (isTaskClosed(entity as TaskEntityWithProperties)) {
        return false;
      }
      return true;
    }

    if (entity.type === 'document' || entity.type === 'project') {
      return true;
    }

    return false;
  };

  const execute = async (entities: EntityData[]) => {
    const source = notificationSource();

    for (const entity of entities) {
      if (entity.type === 'email') {
        archiveEmail(entity.id, {
          isDone: entity.done,
          optimisticallyExclude: true,
        });
      }

      markNotificationsForEntityAsDone(source, entity);

      const entityType = getPropertiesEntityType(entity);
      if (entityType) {
        setPropertyStatusCompleteMutation.mutate({
          entityType,
          entityId: entity.id,
        });
      }
    }

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
    const shouldNavigate =
      soup.filters.isActive('signal') || soup.filters.isActive('noise');
    if (nextEntity && shouldNavigate) {
      soup.focus.set(nextEntity.id);
      onNavigate?.(nextEntity);
    }
  };

  return { canExecute, execute, executeWithSoup };
};
