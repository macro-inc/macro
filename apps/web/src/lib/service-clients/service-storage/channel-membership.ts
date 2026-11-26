import { Telemetry } from '@macro-inc/observability';
import { createRequest, type Exchange } from '@urql/core';
import { pipe, tap } from 'wonka';
import {
  SoupUpdatesDocument,
  type SoupUpdatesSubscription,
} from './graphql/generated/graphql';

/** A live update about the viewer's place in one channel: `member` false
 * when it shows them out or deletes its record. */
export type ChannelMembershipPatch = { channelId: string; member: boolean };

type ChannelMembershipListener = (patch: ChannelMembershipPatch) => void;

const membershipListeners = new Set<ChannelMembershipListener>();

const SOUP_UPDATES_KEY = createRequest(SoupUpdatesDocument, {}).key;

/** Subscribes to live changes of the viewer's channel membership, as the
 * soup subscription delivers them, before the cache has written them. */
export function subscribeToChannelMembership(
  listener: ChannelMembershipListener
): () => void {
  membershipListeners.add(listener);
  return () => membershipListeners.delete(listener);
}

function publishChannelMembership(patch: ChannelMembershipPatch): void {
  for (const listener of membershipListeners) {
    try {
      listener(patch);
    } catch (error) {
      Telemetry.error(error, { surface: 'graphql-channel-membership' });
    }
  }
}

/** The membership changes `patches` carry. */
function channelMembershipPatches(
  patches: SoupUpdatesSubscription['soupUpdates']
): ChannelMembershipPatch[] {
  const changes: ChannelMembershipPatch[] = [];
  for (const patch of patches) {
    if (patch.__typename === 'GraphqlCacheDeletion') {
      if (patch.graphqlTypeName === 'GraphqlSoupChannel')
        changes.push({ channelId: patch.entityId, member: false });
      continue;
    }
    if (patch.item.__typename !== 'GraphqlSoupChannel') continue;
    changes.push({
      channelId: patch.item.id,
      member: patch.item.isParticipant,
    });
  }
  return changes;
}

/**
 * Place after the normalized-cache exchange (toward the transport), beside
 * `notificationReceiptExchange`: it publishes the channel membership changes
 * a soup update carries as the frame arrives, before the cache has written
 * it (writes wait while every tab is hidden), under a
 * `channel_membership.receive` span, so the work a change starts (a departure
 * check) is parented on the update that showed it.
 */
export function channelMembershipReceiptExchange(): Exchange {
  return ({ forward }) =>
    (operations) =>
      pipe(
        forward(operations),
        tap((result) => {
          if (
            result.operation.kind !== 'subscription' ||
            result.operation.key !== SOUP_UPDATES_KEY ||
            result.data == null
          )
            return;
          const changes = channelMembershipPatches(
            (result.data as SoupUpdatesSubscription).soupUpdates
          );
          if (changes.length === 0) return;
          const span = Telemetry.span('channel_membership.receive');
          span.setAttr('channel_membership.changes', changes.length);
          span.setAttr(
            'channel_membership.departures',
            changes.filter(({ member }) => !member).length
          );
          try {
            span.run(() => {
              for (const change of changes) publishChannelMembership(change);
            });
          } finally {
            span.end();
          }
        })
      );
}
