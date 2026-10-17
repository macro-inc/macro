import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import {
  ChannelDetailSoupDocument,
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  GroupSoupDocument,
  HomeUnreadPresenceDocument,
  SoupDocument,
  SoupNotificationsDocument,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { delegateChannelNotificationRefresh } from '../channel/notification-refresh';
import { getActiveGraphqlSoupRevalidations } from '../soup/graphql/active-queries';

type NotificationReader = {
  client: () => Client;
  isEnabled: () => boolean;
  refresh: () => Promise<unknown>;
};

const notificationReaders = new Set<NotificationReader>();
const notificationDocuments = new Set<QueryRevalidation['document']>([
  ChannelDetailSoupDocument,
  ChannelListSoupDocument,
  ChannelUnreadPresenceDocument,
  GroupSoupDocument,
  HomeUnreadPresenceDocument,
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
 * Reads mounted notification readers again for the uncached transport, whose
 * lists have no other way to learn of a write. With the normalized cache the
 * written rows update every reader instead (FE-56). Reuses loaded page
 * variables instead of resetting pagination or reading all cached history.
 * Disabled/unstarted notification feeds remain dormant.
 */
export async function revalidateNotificationReaders(
  client: Client
): Promise<void> {
  const pages = getActiveGraphqlSoupRevalidations(client).filter(
    ({ document }) => notificationDocuments.has(document)
  );
  await Promise.all([
    ...pages.map(({ document, variables }) =>
      refreshSafely(async () => {
        if (delegateChannelNotificationRefresh(client, { document, variables }))
          return;
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
