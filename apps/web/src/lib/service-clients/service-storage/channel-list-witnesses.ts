import { CHANNEL_MENTION_EDGE_LIMIT } from '@queries/channel/mention-edge';
import { createRequest, type Exchange, makeOperation } from '@urql/core';
import { map, pipe } from 'wonka';
import {
  SoupChannelListCacheWriteDocument,
  type SoupChannelListCacheWriteSubscription,
  type SoupNotificationFieldsFragment,
  SoupUpdatesDocument,
  type SoupUpdatesSubscription,
} from './graphql/generated/graphql';

function isTopLevelWitness(notification: SoupNotificationFieldsFragment) {
  const metadata = notification.metadata;
  switch (notification.eventType) {
    case 'channel_message_send':
    case 'channel_access_requested':
      // These events are channel-scoped. Thread replies have a separate event type.
      return true;
    case 'channel_mention':
      return (
        metadata.__typename === 'GraphqlChannelMentionMetadata' &&
        metadata.channelMentionThreadId == null
      );
    case 'document_mention':
      return (
        metadata.__typename === 'GraphqlDocumentMentionMetadata' &&
        metadata.documentMentionThreadId == null
      );
    default:
      return false;
  }
}

/** The unfiltered active edge arrives newest first, with the server tie break. */
function channelListWitnesses(
  notifications: readonly SoupNotificationFieldsFragment[]
) {
  const unreadNotifications: Pick<
    SoupNotificationFieldsFragment,
    'id' | 'state' | 'createdAt'
  >[] = [];
  const unreadMentions: Pick<SoupNotificationFieldsFragment, 'id' | 'state'>[] =
    [];
  for (const notification of notifications) {
    if (notification.state !== 'UNSEEN') continue;
    if (
      unreadMentions.length < CHANNEL_MENTION_EDGE_LIMIT &&
      notification.eventType === 'channel_mention'
    )
      unreadMentions.push({ id: notification.id, state: notification.state });
    if (unreadNotifications.length === 0 && isTopLevelWitness(notification))
      unreadNotifications.push({
        id: notification.id,
        state: notification.state,
        createdAt: notification.createdAt,
      });
    if (
      unreadNotifications.length &&
      unreadMentions.length === CHANNEL_MENTION_EDGE_LIMIT
    )
      break;
  }
  return { unreadNotifications, unreadMentions };
}

let soupUpdatesKey: number | undefined;

/** Add bounded links to the same normalized write as the complete pushed row. */
export const channelListWitnessExchange: Exchange =
  ({ forward }) =>
  (operations) =>
    pipe(
      forward(operations),
      map((result) => {
        if (
          result.operation.kind !== 'subscription' ||
          result.data == null ||
          result.error
        )
          return result;

        soupUpdatesKey ??= createRequest(SoupUpdatesDocument, {}).key;
        if (result.operation.key !== soupUpdatesKey) return result;

        const source = result.data as SoupUpdatesSubscription;
        if (
          source.soupUpdates.some(
            (patch) =>
              patch.__typename === 'SoupUpdated' &&
              patch.item.__typename === 'GraphqlSoupChannel' &&
              !Array.isArray(patch.item.notifications)
          )
        )
          return result;
        let changed = false;
        const soupUpdates = source.soupUpdates.map(
          (
            patch
          ): SoupChannelListCacheWriteSubscription['soupUpdates'][number] => {
            if (patch.__typename !== 'SoupUpdated') return patch;
            const item = patch.item;
            if (item.__typename !== 'GraphqlSoupChannel')
              return { ...patch, item };
            changed = true;
            return {
              ...patch,
              item: {
                ...item,
                ...channelListWitnesses(item.notifications),
              },
            };
          }
        );
        if (!changed) return result;

        return {
          ...result,
          operation: makeOperation('subscription', {
            ...result.operation,
            query: SoupChannelListCacheWriteDocument,
            variables: {},
          }),
          data: { soupUpdates } satisfies SoupChannelListCacheWriteSubscription,
        };
      })
    );
