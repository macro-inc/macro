import { dateBucket } from '@app/features/soup/collection/date-buckets';
import {
  deduplicateItems,
  groupSoupEntities,
} from '@app/features/soup/collection/transforms';
import type { SoupGroup } from '@app/features/soup/collection/types';
import type { EntityWithRawNotifications } from '@app/features/soup/entity-notifications';
import type { DateValue } from '@core/util/date';
import type { EntityData } from '@entity';
import {
  homeDateBucket,
  homeDateBucketRank,
  homeTimestamp,
} from './home-date-buckets';
import {
  type InboxViewContext,
  inboxTabIsNotificationFeed,
} from './inbox-query';

type InboxOrderContext = Pick<InboxViewContext, 'tab' | 'capabilities'>;

export const inboxSortTimestamp = (entity: EntityData) =>
  entity.sortTs ?? entity.updatedAt ?? entity.createdAt;

/**
 * The timestamp a row is bucketed on. The notification feeds (Signal, Noise)
 * bucket on the viewer's latest notification so a fresh comment on a stale
 * entity reads as today's news. A live websocket notification stamps
 * `notifiedAt` right away (`bumpSoupEntityNotifiedAt`), so this holds even
 * while the server keeps sorting by content recency — the `notified_at` server
 * sort is gated for cost, but client bucketing is free. Rows without a stamp,
 * and the other tabs, fall back to content recency.
 */
export const inboxGroupTimestamp = (
  entity: EntityData,
  context: InboxOrderContext
) =>
  (inboxTabIsNotificationFeed(context.tab) ? entity.notifiedAt : undefined) ??
  inboxSortTimestamp(entity);

export function groupInboxEntitiesByDate<T extends EntityData>(
  entities: T[],
  context: InboxOrderContext,
  now = new Date(),
  getTimestamp: (entity: EntityData) => DateValue | null | undefined = (
    entity
  ) => inboxGroupTimestamp(entity, context)
): SoupGroup<T>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) => dateBucket(getTimestamp(entity), now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      dateBucket(getTimestamp(firstEntity), now).label,
  });
}

const compareHomeDates = (first: unknown, second: unknown) => {
  const a = homeTimestamp(first) ?? -Infinity;
  const b = homeTimestamp(second) ?? -Infinity;
  return a === b ? 0 : a > b ? -1 : 1;
};

const compareIdentity = (a: string, b: string) =>
  a === b ? 0 : a < b ? -1 : 1;

const compareHomeEntities = (a: EntityData, b: EntityData) =>
  compareHomeDates(a.sortTs, b.sortTs) ||
  compareIdentity(a.type, b.type) ||
  compareIdentity(a.id, b.id);

const latestTimestamp = (
  first: DateValue | null | undefined,
  second: DateValue | null | undefined
) => (compareHomeDates(first, second) <= 0 ? first : second);

/** Content freshness and Home ordering are independent: keep the newest
 * payload, both source stamps, and the notification source's metadata. */
export function mergeHomeEntities(
  notifications: EntityWithRawNotifications<EntityData>[],
  recents: EntityWithRawNotifications<EntityData>[],
  context: InboxOrderContext
): EntityWithRawNotifications<EntityData>[] {
  return deduplicateItems<EntityWithRawNotifications<EntityData>>(
    [
      ...notifications.map((entity) => ({
        ...entity,
        sortTs: inboxGroupTimestamp(entity, context),
      })),
      // Cache inserts from other users are not the viewer's own activity.
      ...recents
        .filter((entity) => homeTimestamp(entity.touchedAt) !== undefined)
        .map((entity) => ({
          ...entity,
          sortTs: entity.touchedAt,
        })),
    ],
    {
      getKey: (entity) => `${entity.type}:${entity.id}`,
      resolveConflict: (existing, incoming) => ({
        ...(compareHomeDates(
          incoming.updatedAt ?? incoming.createdAt,
          existing.updatedAt ?? existing.createdAt
        ) < 0
          ? incoming
          : existing),
        notifications: existing.notifications ?? incoming.notifications,
        notifiedAt: latestTimestamp(existing.notifiedAt, incoming.notifiedAt),
        touchedAt: latestTimestamp(existing.touchedAt, incoming.touchedAt),
        sortTs: latestTimestamp(existing.sortTs, incoming.sortTs),
      }),
    }
  ).sort(compareHomeEntities);
}

/** Home uses its merged timestamp and finer intraday sections. */
export function groupHomeEntitiesByDate<T extends EntityData>(
  entities: T[],
  now: Date
): SoupGroup<T>[] {
  return groupSoupEntities([...entities].sort(compareHomeEntities), {
    getGroupId: (entity) => homeDateBucket(entity.sortTs, now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      homeDateBucket(firstEntity.sortTs, now).label,
    compareGroups: (a, b) =>
      homeDateBucketRank(a.id) - homeDateBucketRank(b.id),
  });
}
