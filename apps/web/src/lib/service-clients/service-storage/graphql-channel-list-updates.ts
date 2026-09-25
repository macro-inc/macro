import type { Client } from '@urql/core';
import { revalidateChannelLists } from '../../queries/soup/graphql/channel-list-revalidation';
import type { GraphqlNotificationPatch } from './graphql-soup-websocket';

/** Coalesce notification membership changes and recover filtered edges on reconnect. */
export function createChannelListUpdatesHandler(client: Pick<Client, 'query'>) {
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

  return {
    onPatch(patch: GraphqlNotificationPatch) {
      if (
        patch.__typename === 'GraphqlCacheDeletion' ||
        patch.notification.entityType === 'CHANNEL'
      )
        schedule(patch.__typename === 'GraphqlNewNotification');
    },
    reconnect: () => schedule(),
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}
