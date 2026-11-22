import { Telemetry } from '@macro-inc/observability';
import type { SoupUpdatesSubscription } from './graphql/generated/graphql';

/** A live update about the viewer's place in one channel: `member` false
 * when it shows them out or deletes its record. */
export type ChannelMembershipPatch = { channelId: string; member: boolean };

type ChannelMembershipListener = (patch: ChannelMembershipPatch) => void;

const membershipListeners = new Set<ChannelMembershipListener>();

/** Subscribes to live changes of the viewer's channel membership, as the
 * soup subscription delivers them, before the cache has written them. */
export function subscribeToChannelMembership(
  listener: ChannelMembershipListener
): () => void {
  membershipListeners.add(listener);
  return () => membershipListeners.delete(listener);
}

export function publishChannelMembership(patch: ChannelMembershipPatch): void {
  for (const listener of membershipListeners) {
    try {
      listener(patch);
    } catch (error) {
      Telemetry.error(error, { surface: 'graphql-channel-membership' });
    }
  }
}

/** The membership changes `patches` carry. */
export function channelMembershipPatches(
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
