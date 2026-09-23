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
    registerGraphqlSoupRevalidations(() =>
      enabled() ? [{ document: ChannelUnreadPresenceDocument, variables }] : []
    )
  );
  onCleanup(
    registerActiveGraphqlSoupQuery({
      isEnabled: enabled,
      refresh: async () => {
        await query.refetch({
          requestPolicy: 'network-only',
          throwOnError: true,
        });
      },
    })
  );
  return query;
}
