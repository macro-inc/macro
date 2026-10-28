import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  ChannelDetailSoupDocument,
  type ChannelDetailSoupQuery,
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

/** Complete, live unread channel notifications; never read the global GraphQL feed. */
export function createChannelNotificationsQuery(
  channelId: string,
  enabled: Accessor<boolean>
) {
  // The same variables as the open detail, so both read one request.
  const variables = {
    input: buildGraphqlEntitySoupInput('CHANNEL', channelId)!,
  };
  const query = createUrqlQuery(() => ({
    query: ChannelDetailSoupDocument,
    client: getGraphqlSoupClient(),
    variables,
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select: (data: ChannelDetailSoupQuery) =>
      (
        data.user.soup.items.find((item) => item.id === channelId)
          ?.notifications ?? []
      ).map(mapGraphqlNotification),
  }));
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: [{ document: ChannelDetailSoupDocument, variables }],
    reader: {
      enabled: enabled(),
      fetching: query.isFetching,
      channelId,
      // Unread only: a read update can remove a known notification.
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
        enabled() ? [{ document: ChannelDetailSoupDocument, variables }] : [],
      getGraphqlSoupClient
    )
  );

  return query;
}
