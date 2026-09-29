import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  ChannelUnreadPresenceDocument,
  type ChannelUnreadPresenceQuery,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, onCleanup } from 'solid-js';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '../soup/graphql/active-queries';

import { registerChannelNotificationRefresh } from './register-notification-refresh';

function unreadWitnesses(data: ChannelUnreadPresenceQuery) {
  return data.user.soup.items.flatMap((item) =>
    item.__typename === 'GraphqlSoupChannel' ? item.unreadNotifications : []
  );
}

/** Bounded unread evidence for the sidebar, independent of the full feed. */
export function createChannelUnreadQuery(
  input: SoupInput,
  enabled: Accessor<boolean>
) {
  const variables = { input };
  const query = createUrqlQuery(() => ({
    query: ChannelUnreadPresenceDocument,
    client: getGraphqlSoupClient(),
    variables,
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select: unreadWitnesses,
  }));
  onCleanup(
    registerGraphqlSoupRevalidations(
      () =>
        enabled()
          ? [{ document: ChannelUnreadPresenceDocument, variables }]
          : [],
      getGraphqlSoupClient
    )
  );
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: [{ document: ChannelUnreadPresenceDocument, variables }],
    reader: {
      enabled: enabled(),
      fetching: query.isFetching,
      filtered: true,
      notificationIds: query.isSuccess
        ? (query.data ?? []).map((n) => n.id)
        : [],
    },
  }));
  onCleanup(registerActiveGraphqlSoupQuery({ isEnabled: enabled, refresh }));
  return query;
}
