import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { notificationServiceClient } from '../service-notification/client';
import type { NotificationUpdateOperation } from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';
import {
  executeGraphqlUpdateNotifications,
  executeGraphqlUpdateNotificationsForEntities,
  type GraphqlUpdateNotificationsArgs,
  type GraphqlUpdateNotificationsForEntitiesArgs,
  type GraphqlUpdateNotificationsForEntitiesResult,
  type GraphqlUpdateNotificationsResult,
} from './graphql-update-notifications';

export type { NotificationUpdateOperation };

/** Update user-owned notification statuses through the configured transport. */
export async function updateNotifications(
  args: GraphqlUpdateNotificationsArgs
): Promise<GraphqlUpdateNotificationsResult> {
  if (!isFeatureEnabled(enableGraphqlSoup)) {
    const request = { notificationIds: args.notificationIds };
    switch (args.operation) {
      case 'MARK_SEEN':
        await throwOnErr(
          async () =>
            await notificationServiceClient.bulkMarkNotificationAsSeen(request)
        );
        break;
      case 'MARK_DONE':
        await throwOnErr(
          async () =>
            await notificationServiceClient.bulkMarkNotificationAsDone(request)
        );
        break;
      case 'MARK_UNDONE':
        await throwOnErr(
          async () =>
            await notificationServiceClient.bulkMarkNotificationAsUndone(
              request
            )
        );
        break;
    }
    return [];
  }

  const result = await executeGraphqlUpdateNotifications(
    getGraphqlSoupClient(),
    args
  );
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error('updateNotifications mutation returned no data');
  }
  return result.data.updateNotifications;
}

/**
 * Update every user-owned notification associated with the supplied entities.
 *
 * The entity mutation is GraphQL-only and intentionally waits for committed,
 * authoritative rows so callers can retain the exact IDs for undo.
 */
export async function updateNotificationsForEntities(
  args: GraphqlUpdateNotificationsForEntitiesArgs
): Promise<GraphqlUpdateNotificationsForEntitiesResult> {
  if (args.entities.length === 0) return [];

  const result = await executeGraphqlUpdateNotificationsForEntities(
    getGraphqlSoupClient(),
    args
  );
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error('updateNotificationsForEntity mutation returned no data');
  }
  return result.data.updateNotificationsForEntity;
}
