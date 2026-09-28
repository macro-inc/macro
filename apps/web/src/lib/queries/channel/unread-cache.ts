import type { CacheHost } from '@graphql-cache/host/types';
import {
  ChannelUnreadCacheWriteDocument,
  type ChannelUnreadCacheWriteSubscription,
  ChannelUnreadMembershipCacheWriteDocument,
  type ChannelUnreadMembershipCacheWriteQuery,
  ChannelUnreadPresenceDocument,
  type ChannelUnreadPresenceQueryVariables,
  type SoupNotificationFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { stringifyDocument } from '@urql/core';
import { getChannelListRevalidations } from '../soup/graphql/channel-list-revalidation';

const channelMessageEvents = new Set([
  'channel_mention',
  'channel_message_send',
  'channel_message_reply',
  'document_mention',
]);

const relationshipQuery = stringifyDocument(ChannelUnreadCacheWriteDocument);
const membershipQuery = stringifyDocument(
  ChannelUnreadMembershipCacheWriteDocument
);

/**
 * Link a delivered notification into the bounded channel edge. The subscription
 * has already normalized its full record; no server lookup or global feed is
 * needed. Only the unread witness and badge membership are written, never
 * snapshots of unrelated notification states or channel metadata.
 *
 * The caller serializes deliveries and fences cache-generation changes. A cold
 * badge cache cannot be patched safely and falls back to reconciliation.
 */
export async function cacheNewChannelUnread(
  host: Pick<CacheHost, 'writeQuery' | 'readQuery'>,
  notification: SoupNotificationFieldsFragment,
  isCurrent: () => boolean
): Promise<boolean> {
  if (
    !isCurrent() ||
    notification.entityType !== 'CHANNEL' ||
    notification.state !== 'UNSEEN' ||
    !channelMessageEvents.has(notification.eventType)
  ) {
    return false;
  }

  const channel = {
    __typename: 'GraphqlSoupChannel' as const,
    id: notification.entityId,
  };
  await host.writeQuery({
    query: relationshipQuery,
    operationName: 'ChannelUnreadCacheWrite',
    data: {
      soupUpdates: [
        {
          __typename: 'SoupUpdated',
          item: {
            ...channel,
            unreadNotifications: [
              {
                id: notification.id,
                state: notification.state,
                createdAt: notification.createdAt,
              },
            ],
          },
        },
      ],
    } satisfies ChannelUnreadCacheWriteSubscription,
  });

  let complete = true;
  for (const page of getChannelListRevalidations()) {
    if (!isCurrent()) return false;
    if (page.document !== ChannelUnreadPresenceDocument) continue;
    const variables = page.variables as ChannelUnreadPresenceQueryVariables;
    const initial = variables.input.initial;
    // This is the app-shell presence query, not an arbitrary filtered list.
    const filter = initial?.filters?.channelFilter?.literal;
    if (
      !initial ||
      !filter ||
      filter.notificationState !== 'UNSEEN' ||
      Object.keys(filter).length !== 1
    ) {
      complete = false;
      continue;
    }
    const read = await host.readQuery({
      query: membershipQuery,
      operationName: 'ChannelUnreadMembershipCacheWrite',
      variables,
      priority: 'user-visible',
    });
    if (!isCurrent()) return false;
    if (read.kind !== 'hit') {
      complete = false;
      continue;
    }
    // The generated document defines the normalized cache result's shape.
    const data = read.data as ChannelUnreadMembershipCacheWriteQuery;
    if (data.user.soup.items.some((item) => item.id === channel.id)) continue;
    const limit = Math.min(initial.limit ?? 500, 500);
    await host.writeQuery({
      query: membershipQuery,
      operationName: 'ChannelUnreadMembershipCacheWrite',
      variables,
      data: {
        user: {
          id: data.user.id,
          soup: { items: [channel, ...data.user.soup.items].slice(0, limit) },
        },
      } satisfies ChannelUnreadMembershipCacheWriteQuery,
    });
  }
  return complete && isCurrent();
}
