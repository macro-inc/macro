import { isTransientRequestError } from '@core/util/request-error';
import type { UnifiedNotification } from '@notifications/types';
import {
  SoupUnseenNotificationsDocument,
  type SoupUnseenNotificationsQuery,
} from '@service-storage/graphql/generated/graphql';
import { mapGraphqlNotification } from '@service-storage/graphql-soup';
import { type Accessor, createMemo } from 'solid-js';
import { createChannelNotificationsQuery } from '../../channel/notifications';
import {
  buildGraphqlEntitySoupInput,
  type SoupEntityRef,
} from '../../soup/graphql/entity-input';
import {
  createLiveNotificationQuery,
  createSharedNotificationReads,
} from './shared-notification-query';

function selectUnseenNotifications(
  data: SoupUnseenNotificationsQuery,
  entityId: string
): UnifiedNotification[] {
  return (
    data.user.soup.items.find((item) => item.id === entityId)?.notifications ??
    []
  ).map(mapGraphqlNotification);
}

/** Complete, live unseen notifications of one Soup entity; never the global feed. */
function createEntityUnseenNotificationsQuery(
  entityType: SoupEntityRef['entityType'],
  entityId: string,
  enabled: Accessor<boolean>
) {
  return createLiveNotificationQuery({
    entityId,
    query: SoupUnseenNotificationsDocument,
    variables: { input: buildGraphqlEntitySoupInput(entityType, entityId)! },
    select: (data) => selectUnseenNotifications(data, entityId),
    enabled,
    // A row the edge does not hold matters only once an update makes it unseen.
    updateChangesEdge: (update, held, cacheMaintained) =>
      held ? !cacheMaintained : update.state === 'UNSEEN',
    surface: 'entity-unseen-notifications',
  });
}

const sharedUnseenNotifications =
  createSharedNotificationReads<Accessor<readonly UnifiedNotification[]>>();

/**
 * One entity's unseen notifications, from one live query however many threads
 * show its messages. A channel reads the unread edge its open view and detail
 * share. Empty until the first read lands; the query ends a grace period
 * after its last reader leaves.
 */
export function useEntityUnseenNotifications(
  entityType: SoupEntityRef['entityType'],
  entityId: string,
  enabled: Accessor<boolean>
): Accessor<readonly UnifiedNotification[]> {
  return sharedUnseenNotifications(
    `${entityType}:${entityId}`,
    enabled,
    (anyEnabled) => {
      const query =
        entityType === 'CHANNEL'
          ? createChannelNotificationsQuery(entityId, anyEnabled)
          : createEntityUnseenNotificationsQuery(
              entityType,
              entityId,
              anyEnabled
            );
      return createMemo((): readonly UnifiedNotification[] => {
        if (!query.isEnabled || query.isPending) return [];
        if (query.error && !isTransientRequestError(query.error)) return [];
        return query.data ?? [];
      });
    }
  );
}
