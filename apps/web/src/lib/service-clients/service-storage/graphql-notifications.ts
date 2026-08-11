import { ENABLE_GRAPHQL_SOUP } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { notificationServiceClient } from '../service-notification/client';
import type { NotificationUpdateOperation } from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';
import {
  executeGraphqlUpdateNotifications,
  type GraphqlUpdateNotificationsArgs,
  type GraphqlUpdateNotificationsResult,
} from './graphql-update-notifications';

export type { NotificationUpdateOperation };

/** Update user-owned notification statuses through the configured transport. */
export async function updateNotifications(
  args: GraphqlUpdateNotificationsArgs
): Promise<GraphqlUpdateNotificationsResult> {
  if (!ENABLE_GRAPHQL_SOUP()) {
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
