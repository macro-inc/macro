import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  ChannelRecentlyOpenedDocument,
  type ChannelRecentlyOpenedQuery,
  type SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';

function channelIds(data: ChannelRecentlyOpenedQuery): string[] {
  return data.user.soup.items.flatMap((item) =>
    item.__typename === 'GraphqlSoupChannel' ? [item.id] : []
  );
}

/** The ids of the channels the viewer opened last, in the server's order. */
export function createRecentlyOpenedChannelsQuery(
  input: SoupInput,
  enabled: Accessor<boolean>
) {
  const variables = { input };
  return createUrqlQuery(() => ({
    query: ChannelRecentlyOpenedDocument,
    client: getGraphqlSoupClient(),
    variables,
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select: channelIds,
  }));
}
