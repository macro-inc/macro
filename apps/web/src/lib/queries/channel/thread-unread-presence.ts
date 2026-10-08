import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  ChannelThreadUnreadPresenceDocument,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, onCleanup } from 'solid-js';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '../soup/graphql/active-queries';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

/** A bounded unread witness query shared by the sidebar and Threads tab. */
export function createChannelThreadUnreadQuery(
  input: Accessor<SoupInput>,
  enabled: Accessor<boolean>
) {
  const descriptor = () => ({
    document: ChannelThreadUnreadPresenceDocument,
    variables: { input: input() },
  });
  const query = createUrqlQuery(() => ({
    query: ChannelThreadUnreadPresenceDocument,
    client: getGraphqlSoupClient(),
    variables: descriptor().variables,
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select: (data) =>
      data.user.soup.items.flatMap((item) =>
        item.__typename === 'GraphqlSoupChannelMessage'
          ? [
              ...item.unreadThreadNotifications,
              ...item.unreadThreadImportant,
            ].map((notification) => ({
              ...notification,
              channelId: item.channelId,
            }))
          : []
      ),
  }));
  onCleanup(
    registerGraphqlSoupRevalidations(
      () => (enabled() ? [descriptor()] : []),
      getGraphqlSoupClient
    )
  );
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: [descriptor()],
    reader: {
      enabled: enabled(),
      fetching: query.isFetching,
      filtered: true,
      notificationIds: query.isSuccess
        ? (query.data ?? []).map((notification) => notification.id)
        : [],
    },
  }));
  onCleanup(registerActiveGraphqlSoupQuery({ isEnabled: enabled, refresh }));
  return query;
}
