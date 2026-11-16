import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import type { Entity } from '@core/types';
import { createDocumentNotificationsQuery } from '@queries/notification/graphql/document-notifications';
import { type Accessor, createMemo, untrack } from 'solid-js';
import type { NotificationSource } from './notification-source';
import { compositeEntity, type UnifiedNotification } from './types';

/**
 * The notifications of an open entity. With GraphQL Soup a document reads its
 * own live notification edge, so opening it never starts the full feed; other
 * entity types and the REST transport read the feed.
 */
export function useOpenEntityNotifications(
  notificationSource: NotificationSource,
  entity: Entity
): Accessor<UnifiedNotification[]> {
  const graphqlSoupFlag = useFeatureFlag(enableGraphqlSoup);
  const documentQuery = createMemo(() =>
    graphqlSoupFlag().enabled && entity.type === 'document'
      ? untrack(() => createDocumentNotificationsQuery(entity.id))
      : undefined
  );
  return createMemo(() => {
    // Until the flags say which transport applies, reading the feed could
    // start it for a document that has an edge of its own.
    if (graphqlSoupFlag().loading) return [];
    const query = documentQuery();
    if (!query) {
      return (
        notificationSource.notificationsByEntity()[compositeEntity(entity)] ??
        []
      );
    }
    const notifications = query.data ?? [];
    const withLocalOverrides = notificationSource.withLocalOverrides;
    return withLocalOverrides
      ? notifications.map(withLocalOverrides)
      : notifications;
  });
}
