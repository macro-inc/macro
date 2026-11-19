import type { Entity } from '@core/types';
import { useDocumentNotificationsQuery } from '@queries/notification/graphql/document-notifications';
import { type Accessor, createMemo, untrack } from 'solid-js';
import type { NotificationSource } from './notification-source';
import { compositeEntity, type UnifiedNotification } from './types';

/**
 * The notifications of an open entity. A document reads its own live
 * notification edge, so opening it never starts the full feed; other entity
 * types read the feed.
 */
export function useOpenEntityNotifications(
  notificationSource: NotificationSource,
  entity: Entity
): Accessor<UnifiedNotification[]> {
  const documentQuery =
    entity.type === 'document'
      ? untrack(() =>
          useDocumentNotificationsQuery(entity.id, notificationSource.isEnabled)
        )
      : undefined;
  return createMemo(() => {
    if (!documentQuery) {
      return (
        notificationSource.notificationsByEntity()[compositeEntity(entity)] ??
        []
      );
    }
    // The feed shows nothing while the session cannot read notifications.
    if (!notificationSource.isEnabled()) return [];
    const notifications = documentQuery.data ?? [];
    const withLocalOverrides = notificationSource.withLocalOverrides;
    return withLocalOverrides
      ? notifications.map(withLocalOverrides)
      : notifications;
  });
}
