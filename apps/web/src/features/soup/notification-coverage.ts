import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';

/**
 * GraphQL list rows carry their own notification edges, independently of the
 * global source's pagination. REST rows rely on that source finishing its load.
 */
export function hasNotificationCoverage(
  entities: EntityData[],
  source: NotificationSource
): boolean {
  if (
    entities.every(
      (entity) =>
        entity.type === 'email' ||
        ('notifications' in entity &&
          (Array.isArray(entity.notifications) ||
            typeof entity.notifications === 'function'))
    )
  )
    return true;
  return (
    !source.isLoading() &&
    !source._notificationsQuery.error &&
    !source._notificationsQuery.hasNextPage
  );
}
