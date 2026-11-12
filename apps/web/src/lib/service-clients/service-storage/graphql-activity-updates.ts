import type { Client, OperationResult } from '@urql/core';
import {
  type ActivityInvalidation,
  revalidateActivityQueries,
} from '../../queries/activity/push-registry';
import type { ActivityUpdatesSubscription } from './graphql/generated/graphql';

export const ACTIVITY_PUSH_DEBOUNCE_MS = 300;
export const ACTIVITY_PUSH_JITTER_MS = 700;

/** Coalesces pushes and reconnect recovery for this connection's mounted queries. */
export function createActivityUpdatesHandler(
  client: Pick<Client, 'query' | 'subscription'>
) {
  let pending: ActivityInvalidation = new Set<string>();
  let refreshNonFollowers = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let running = false;
  let dirty = false;
  const flush = async () => {
    timer = undefined;
    if (disposed || running || document.hidden || !dirty) return;
    running = true;
    dirty = false;
    const entities = pending;
    const nonFollowers = refreshNonFollowers;
    pending = new Set();
    refreshNonFollowers = false;
    try {
      await revalidateActivityQueries(client, entities, {
        refreshNonFollowers: nonFollowers,
      });
    } finally {
      running = false;
      if (dirty) schedule();
    }
  };
  const schedule = () => {
    if (disposed || timer !== undefined || running || !dirty) return;
    timer = setTimeout(
      flush,
      ACTIVITY_PUSH_DEBOUNCE_MS + Math.random() * ACTIVITY_PUSH_JITTER_MS
    );
  };
  const visible = () => {
    if (!document.hidden) schedule();
  };
  document.addEventListener('visibilitychange', visible);
  return {
    onResult(result: OperationResult<ActivityUpdatesSubscription>) {
      if (disposed || result.error) return;
      const patch = result.data?.activityUpdates;
      if (!patch) return;
      if (patch.__typename === 'GraphqlActivityEvent' && pending !== null) {
        pending = new Set([...pending, patch.entityId]);
      } else {
        pending = null;
      }
      dirty = true;
      schedule();
    },
    reconnect() {
      if (disposed) return;
      pending = null;
      dirty = true;
      schedule();
    },
    /**
     * The first connection's subscriptions are live. Queries that follow
     * them read after this; the others may show older reads.
     */
    live() {
      if (disposed) return;
      refreshNonFollowers = true;
      dirty = true;
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
      pending = new Set();
      refreshNonFollowers = false;
      dirty = false;
    },
  };
}
