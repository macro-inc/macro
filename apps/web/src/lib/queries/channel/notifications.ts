import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  SoupNotificationsDocument,
  type SoupNotificationsQuery,
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

/** Complete, live channel notifications; never read the global GraphQL feed. */
export function createChannelNotificationsQuery(
  channelId: string,
  enabled: Accessor<boolean>
) {
  const variables = {
    input: buildGraphqlEntitySoupInput('CHANNEL', channelId)!,
  };
  const query = createUrqlQuery(() => ({
    query: SoupNotificationsDocument,
    client: getGraphqlSoupClient(),
    variables,
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select: (data: SoupNotificationsQuery) =>
      (
        data.user.soup.items.find((item) => item.id === channelId)
          ?.notifications ?? []
      ).map(mapGraphqlNotification),
  }));
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: [{ document: SoupNotificationsDocument, variables }],
    reader: {
      enabled: enabled(),
      fetching: query.isFetching,
      channelId,
      filtered: false,
      notificationIds: query.isSuccess
        ? (query.data ?? []).map((n) => n.id)
        : [],
    },
  }));
  onCleanup(registerActiveGraphqlSoupQuery({ isEnabled: enabled, refresh }));
  onCleanup(
    registerGraphqlSoupRevalidations(
      () =>
        enabled() ? [{ document: SoupNotificationsDocument, variables }] : [],
      getGraphqlSoupClient
    )
  );

  return query;
}
