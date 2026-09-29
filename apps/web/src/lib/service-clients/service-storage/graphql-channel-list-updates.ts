import type { CacheHost } from '@graphql-cache/host/types';
import { cacheNewChannelUnread } from '@queries/channel/unread-cache';
import type { Client } from '@urql/core';
import { revalidateChannelLists } from '../../queries/soup/graphql/channel-list-revalidation';
import type { GraphqlNotificationPatch } from './graphql-soup-websocket';

/** Patch delivered unread evidence locally, then reconcile bounded edges. */
export function createChannelListUpdatesHandler(
  client: Pick<Client, 'query'>,
  host?: CacheHost
) {
  const cache = host?.disabled ? undefined : host;
  let cacheGeneration = 0;
  const unsubscribeGeneration = cache?.onCacheGenerationChanged(() => {
    cacheGeneration += 1;
  });
  let pendingPatch = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let running = false;
  let disposed = false;

  const flush = async () => {
    timer = undefined;
    if (disposed || running || document.hidden || !dirty) return;
    running = true;
    dirty = false;
    try {
      await revalidateChannelLists(client);
    } finally {
      running = false;
      if (dirty) schedule();
    }
  };
  const schedule = (immediate = false) => {
    if (disposed) return;
    dirty = true;
    if (running || document.hidden) return;
    if (timer !== undefined) {
      if (!immediate) return;
      clearTimeout(timer);
      timer = undefined;
    }
    // A new notification should light the dot without the debounce delay.
    // Deliveries during this refresh still coalesce into one trailing refresh.
    if (immediate) void flush();
    else timer = setTimeout(flush, 300);
  };
  const visible = () => {
    if (dirty && !document.hidden) schedule();
  };
  document.addEventListener('visibilitychange', visible);

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
    let patched = false;
    try {
      patched = await cacheNewChannelUnread(
        cache,
        patch.notification,
        isCurrent
      );
    } catch (error) {
      console.warn('Failed to cache channel unread notification', error);
    }
    // Local dots no longer await this request. Keep reconciliation for bounded
    // witnesses, unknown/cold channels, and missed updates; failures fall back
    // immediately to the existing network path.
    schedule(!patched);
  };

  return {
    onPatch(patch: GraphqlNotificationPatch) {
      if (disposed) return;
      if (patch.__typename === 'GraphqlCacheDeletion') {
        schedule();
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
      schedule(patch.__typename === 'GraphqlNewNotification');
    },
    reconnect: () => schedule(),
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
      unsubscribeGeneration?.();
    },
  };
}
