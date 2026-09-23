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
  const schedule = () => {
    if (disposed) return;
    dirty = true;
    if (timer !== undefined || running || document.hidden) return;
    timer = setTimeout(flush, 300);
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
        schedule();
    },
    reconnect: schedule,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}
