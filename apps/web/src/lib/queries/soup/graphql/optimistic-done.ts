import { scopeChannelNotificationsForEntity } from '@app/features/soup/entity-notifications';
import type { EntityData } from '@entity/types/entity';
import type { Notification } from '@entity/types/notification';
import { skipToken, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../../client';
import { graphqlSoupKeys } from './keys';

/** How long a done overlay may outlive the action that created it. */
export const GRAPHQL_SOUP_DONE_RETENTION_MS = 60_000;

/** Entities marked done, with the notifications that were active at the time. */
export type PendingGraphqlSoupDone = {
  entityIds: ReadonlySet<string>;
  notificationIds: ReadonlySet<string>;
  /** Unknown IDs can belong to older, previously unloaded notifications. */
  startedAt: number;
  scopeChannelThreads: boolean;
};

export type GraphqlSoupDoneOverlay = {
  /** Stop hiding the entities, e.g. after a rollback or an undo. */
  release: () => void;
};

const PENDING_DONE_KEY = graphqlSoupKeys.pendingDone.queryKey;

/**
 * Hides entities from done-excluding GraphQL lists until the cache or server
 * reflects the done write. The entity-scoped notification mutation is not
 * cache-optimistic, and an optimistic archive still has to be durably queued
 * and re-evaluated by the list, so without this the row stays visible for a
 * worker or server round trip plus the list re-renders.
 */
export function hideGraphqlSoupEntitiesAsDone(args: {
  entityIds: readonly string[];
  notificationIds: readonly string[];
  scopeChannelThreads?: boolean;
}): GraphqlSoupDoneOverlay {
  const entry: PendingGraphqlSoupDone = {
    entityIds: new Set(args.entityIds),
    notificationIds: new Set(args.notificationIds),
    startedAt: Date.now(),
    scopeChannelThreads: args.scopeChannelThreads ?? false,
  };
  queryClient.setQueryData<PendingGraphqlSoupDone[]>(
    PENDING_DONE_KEY,
    (pending) => [...(pending ?? []), entry]
  );
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(expiry);
    queryClient.setQueryData<PendingGraphqlSoupDone[]>(
      PENDING_DONE_KEY,
      (pending) => pending?.filter((candidate) => candidate !== entry)
    );
  };
  // Server pushes and list refreshes replace the overlay long before this. The
  // bound only keeps an overlay from outliving its action indefinitely.
  const expiry = setTimeout(release, GRAPHQL_SOUP_DONE_RETENTION_MS);
  return { release };
}

/** The done overlays currently in effect. */
export function usePendingGraphqlSoupDone(): Accessor<
  readonly PendingGraphqlSoupDone[]
> {
  const pending = useQuery(
    () => ({
      queryKey: PENDING_DONE_KEY,
      queryFn: skipToken,
      initialData: [] as PendingGraphqlSoupDone[],
      // Entries have bounded lifetimes even when no view observes this query.
      gcTime: Infinity,
    }),
    () => queryClient
  );
  return () => (pending.isSuccess ? pending.data : []);
}

function activeNotifications(
  entity: EntityData,
  scopeChannelThreads: boolean
): Notification[] {
  const attached = (entity as { notifications?: unknown }).notifications;
  if (!Array.isArray(attached)) return [];
  const notifications = attached as Notification[];
  const scoped =
    scopeChannelThreads &&
    (entity.type === 'channel' || entity.type === 'channel_thread')
      ? scopeChannelNotificationsForEntity(entity, notifications)
      : notifications;
  return scoped.filter((notification) => notification.state !== 'done');
}

/**
 * Adds the ids a done-excluding list hides to `hiddenIds`. An entity that has
 * an active notification created after the done action (and not marked by it)
 * stays visible. Merely loading an older notification must not reopen the row.
 */
export function withPendingDoneIds(
  hiddenIds: ReadonlySet<string>,
  entities: readonly EntityData[],
  pending: readonly PendingGraphqlSoupDone[]
): ReadonlySet<string> {
  if (pending.length === 0) return hiddenIds;
  let hidden: Set<string> | undefined;
  for (const entity of entities) {
    // A row may have returned through fresh activity since an earlier Done.
    // Its latest action must win even while the older overlay is retained.
    const covering = pending.findLast(({ entityIds }) =>
      entityIds.has(entity.id)
    );
    if (!covering) continue;
    const readmitted = activeNotifications(
      entity,
      covering.scopeChannelThreads
    ).some(
      ({ id, created_at }) =>
        !covering.notificationIds.has(id) &&
        Date.parse(created_at) > covering.startedAt
    );
    if (readmitted) continue;
    hidden ??= new Set(hiddenIds);
    hidden.add(entity.id);
  }
  return hidden ?? hiddenIds;
}
