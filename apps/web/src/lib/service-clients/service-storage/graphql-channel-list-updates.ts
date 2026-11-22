import type { CacheHost } from '@graphql-cache/host/types';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { cacheNewChannelUnread } from '@queries/channel/unread-cache';
import type { Client } from '@urql/core';
import { channelNotificationRefresh } from '../../queries/channel/notification-refresh';
import {
  channelMembershipPatches,
  publishChannelMembership,
} from './channel-membership';
import type { SoupUpdatesSubscription } from './graphql/generated/graphql';
import type { GraphqlNotificationPatch } from './graphql-soup-websocket';

/** A channel this recent is new to its members, allowing for clock skew. */
const NEW_CHANNEL_AGE_MS = 5 * 60_000;

function isNewChannel(createdAt: string): boolean {
  return Date.now() - Date.parse(createdAt) < NEW_CHANNEL_AGE_MS;
}

/** Patch delivered unread evidence locally, then reconcile bounded edges. */
export function createChannelListUpdatesHandler(
  client: Pick<Client, 'query'>,
  host?: CacheHost
) {
  const cache = host?.disabled ? undefined : host;
  const coordinator = channelNotificationRefresh(client);
  let cacheGeneration = 0;
  const unsubscribeGeneration = cache?.onCacheGenerationChanged(() => {
    cacheGeneration += 1;
    coordinator.reset();
  });
  let pendingPatch = Promise.resolve();
  let disposed = false;

  const applyNewNotification = async (
    previous: Promise<void>,
    patch: Extract<
      GraphqlNotificationPatch,
      { __typename: 'GraphqlNewNotification' }
    >,
    generation: number,
    responseGeneration: string
  ): Promise<void> => {
    await previous;
    const isCurrent = () =>
      !disposed &&
      generation === cacheGeneration &&
      cacheSessionGeneration.isCurrent(responseGeneration);
    if (!cache || !isCurrent()) return;
    try {
      await cacheNewChannelUnread(
        cache,
        patch.notification,
        isCurrent,
        responseGeneration
      );
    } catch (error) {
      console.warn('Failed to cache channel unread notification', error);
    }
    if (isCurrent()) coordinator.onPatch(patch, true);
  };

  return {
    onPatch(patch: GraphqlNotificationPatch, normalized = false) {
      if (disposed) return;
      if (patch.__typename === 'GraphqlCacheDeletion') {
        coordinator.onPatch(patch, normalized);
        return;
      }
      if (patch.notification.entityType !== 'CHANNEL') return;
      if (patch.__typename === 'GraphqlNewNotification' && cache) {
        // Serialize read/append writes to the badge's cached membership. Never
        // let a slower earlier delivery overwrite a later one in this client.
        pendingPatch = applyNewNotification(
          pendingPatch,
          patch,
          cacheGeneration,
          cacheSessionGeneration.capture()
        );
        return pendingPatch;
      }
      coordinator.onPatch(patch, normalized);
    },
    /** A new DM, group chat or channel reaches lists that do not show it yet. */
    onSoupUpdates(patches: SoupUpdatesSubscription['soupUpdates']) {
      if (disposed) return;
      for (const change of channelMembershipPatches(patches))
        publishChannelMembership(change);
      for (const patch of patches) {
        if (patch.__typename !== 'SoupUpdated') continue;
        const channel = patch.item;
        if (channel.__typename !== 'GraphqlSoupChannel') continue;
        if (!channel.isParticipant || !isNewChannel(channel.createdAt))
          continue;
        coordinator.expectChannel({
          id: channel.id,
          channelType: channel.channelType,
        });
      }
    },
    reconnect: () => coordinator.reconnect(),
    dispose() {
      disposed = true;
      unsubscribeGeneration?.();
    },
  };
}
