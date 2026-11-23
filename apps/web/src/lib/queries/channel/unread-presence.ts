import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  ChannelUnreadPresenceDocument,
  type ChannelUnreadPresenceQuery,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  hasGraphqlCacheHost,
} from '@service-storage/graphql-soup';
import { onCleanup } from 'solid-js';
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
export function createChannelUnreadQuery(input: SoupInput) {
  const variables = { input };
  const query = createUrqlQuery(() => ({
    query: ChannelUnreadPresenceDocument,
    client: getGraphqlSoupClient(),
    variables,
    requestPolicy: 'cache-and-network',
    select: unreadWitnesses,
  }));
  onCleanup(
    registerGraphqlSoupRevalidations(
      () => [{ document: ChannelUnreadPresenceDocument, variables }],
      getGraphqlSoupClient,
      // Unread is read from each witness's cached state.
      hasGraphqlCacheHost
    )
  );
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: [{ document: ChannelUnreadPresenceDocument, variables }],
    reader: {
      enabled: true,
      fetching: query.isFetching,
      filtered: true,
      notificationIds: query.isSuccess
        ? (query.data ?? []).map((n) => n.id)
        : [],
    },
  }));
  onCleanup(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh,
      cacheMaintained: hasGraphqlCacheHost,
    })
  );
  return query;
}
