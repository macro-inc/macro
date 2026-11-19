import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  ChannelActiveNotificationsDocument,
  type ChannelActiveNotificationsQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlNotification,
} from '@service-storage/graphql-soup';
import { type Accessor, onCleanup } from 'solid-js';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '../soup/graphql/active-queries';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

/**
 * The newest not-done notifications read for one channel. Seen rows stay until
 * they are done, so a channel nobody marks done keeps one per message: the
 * bound keeps the read independent of the channel's history.
 */
export const CHANNEL_ACTIVE_NOTIFICATION_LIMIT = 200;

/**
 * One channel's not-done (unseen or seen) message, reply and mention
 * notifications, newest first, kept live like the channel's unread edge.
 */
export function createChannelActiveNotificationsQuery(
  channelId: string,
  enabled: Accessor<boolean>
) {
  const variables = {
    input: buildGraphqlEntitySoupInput('CHANNEL', channelId)!,
    limit: CHANNEL_ACTIVE_NOTIFICATION_LIMIT,
  };
  const query = createUrqlQuery(() => ({
    query: ChannelActiveNotificationsDocument,
    client: getGraphqlSoupClient(),
    variables,
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select: selectActiveNotifications(channelId),
  }));
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: [{ document: ChannelActiveNotificationsDocument, variables }],
    reader: {
      enabled: enabled(),
      fetching: query.isFetching,
      channelId,
      // Not done only: a done update can remove a known notification.
      filtered: true,
      notificationIds: query.isSuccess
        ? (query.data ?? []).map((n) => n.id)
        : [],
    },
  }));
  onCleanup(registerActiveGraphqlSoupQuery({ isEnabled: enabled, refresh }));
  onCleanup(
    registerGraphqlSoupRevalidations(
      () =>
        enabled()
          ? [{ document: ChannelActiveNotificationsDocument, variables }]
          : [],
      getGraphqlSoupClient
    )
  );

  return query;
}

function selectActiveNotifications(channelId: string) {
  return (data: ChannelActiveNotificationsQuery) => {
    const item = data.user.soup.items.find((entry) => entry.id === channelId);
    if (!item || !('activeMessageNotifications' in item)) return [];
    return item.activeMessageNotifications.map(mapGraphqlNotification);
  };
}
