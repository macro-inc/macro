import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import {
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  GroupSoupDocument,
  SoupDocument,
  SoupNotificationsDocument,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { getActiveGraphqlSoupRevalidations } from '../soup/graphql/active-queries';

type NotificationReader = {
  client: () => Client;
  isEnabled: () => boolean;
  refresh: () => Promise<unknown>;
};

const notificationReaders = new Set<NotificationReader>();
const notificationDocuments = new Set<QueryRevalidation['document']>([
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  GroupSoupDocument,
  SoupDocument,
  SoupNotificationsDocument,
]);

/** Registers an existing notification feed without activating its lazy query. */
export function registerNotificationReader(reader: NotificationReader) {
  notificationReaders.add(reader);
  return () => notificationReaders.delete(reader);
}

async function refreshSafely(refresh: () => Promise<unknown>): Promise<void> {
  try {
    await refresh();
  } catch (error) {
    // A failed refresh cannot undo a committed write or discard its exact undo IDs.
    console.error('Failed to reconcile notification state', error);
  }
}

/**
 * Entity writes return only changed rows. Empty AND partial responses can leave
 * stale notifications behind, so refresh mounted readers after every commit.
 * Reuse loaded page variables instead of resetting pagination or reading all
 * cached history. Disabled/unstarted notification feeds remain dormant.
 */
export async function revalidateNotificationReaders(
  client: Client
): Promise<void> {
  const pages = getActiveGraphqlSoupRevalidations().filter(({ document }) =>
    notificationDocuments.has(document)
  );
  await Promise.all([
    ...pages.map(({ document, variables }) =>
      refreshSafely(async () => {
        const result = await client
          .query(document, variables, { requestPolicy: 'network-only' })
          .toPromise();
        if (result.error) throw result.error;
      })
    ),
    ...[...notificationReaders]
      .filter((reader) => reader.isEnabled() && reader.client() === client)
      .map((reader) => refreshSafely(reader.refresh)),
  ]);
}
