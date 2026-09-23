import {
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { getActiveGraphqlSoupRevalidations } from './active-queries';

/** Filtered notification membership must be re-evaluated after status writes. */
export function getChannelListRevalidations() {
  return getActiveGraphqlSoupRevalidations().filter(
    (query) =>
      query.document === ChannelListSoupDocument ||
      query.document === ChannelUnreadPresenceDocument
  );
}

/** Refresh only mounted channel-list pages, never full notification history. */
export async function revalidateChannelLists(
  client: Pick<Client, 'query'>
): Promise<void> {
  await Promise.all(
    getChannelListRevalidations().map(async ({ document, variables }) => {
      try {
        const result = await client
          .query(document, variables, { requestPolicy: 'network-only' })
          .toPromise();
        if (result.error) throw result.error;
      } catch (error) {
        console.error('Failed to refresh channel unread state', error);
      }
    })
  );
}
