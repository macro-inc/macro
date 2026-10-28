import type { CacheHost } from '@graphql-cache/host/types';
import { cacheNewChannelUnread } from '@queries/channel/unread-cache';
import type { Client } from '@urql/core';
import { channelNotificationRefresh } from '../../queries/channel/notification-refresh';
import type { GraphqlNotificationPatch } from './graphql-soup-websocket';

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
    generation: number
  ): Promise<void> => {
    await previous;
    const isCurrent = () => !disposed && generation === cacheGeneration;
    if (!cache || !isCurrent()) return;
    try {
      await cacheNewChannelUnread(cache, patch.notification, isCurrent);
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
          cacheGeneration
        );
        return pendingPatch;
      }
      coordinator.onPatch(patch, normalized);
    },
    reconnect: () => coordinator.reconnect(),
    dispose() {
      disposed = true;
      unsubscribeGeneration?.();
    },
  };
}
