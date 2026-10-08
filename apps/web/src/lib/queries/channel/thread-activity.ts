import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  ChannelThreadActivityDocument,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, onCleanup } from 'solid-js';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '../soup/graphql/active-queries';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

/** Per-card notification evidence without fetching message bodies or the global feed. */
export function createChannelThreadActivityQuery(input: Accessor<SoupInput>) {
  const descriptor = () => ({
    document: ChannelThreadActivityDocument,
    variables: { input: input() },
  });
  const query = createUrqlQuery(() => ({
    query: ChannelThreadActivityDocument,
    client: getGraphqlSoupClient(),
    variables: descriptor().variables,
    requestPolicy: 'cache-and-network',
    select: (data) =>
      data.user.soup.items.flatMap((item) =>
        item.__typename === 'GraphqlSoupChannelMessage'
          ? [
              {
                pending: item.pendingThreadNotifications,
                unread: [
                  ...item.unreadThreadNotifications,
                  ...item.unreadThreadImportant,
                ],
              },
            ]
          : []
      )[0],
  }));
  onCleanup(
    registerGraphqlSoupRevalidations(() => [descriptor()], getGraphqlSoupClient)
  );
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: [descriptor()],
    reader: {
      enabled: true,
      fetching: query.isFetching,
      filtered: true,
      notificationIds: query.isSuccess
        ? [...(query.data?.pending ?? []), ...(query.data?.unread ?? [])].map(
            (notification) => notification.id
          )
        : [],
    },
  }));
  onCleanup(registerActiveGraphqlSoupQuery({ isEnabled: () => true, refresh }));
  return query;
}
