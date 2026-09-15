import { dateBucket } from '@app/features/soup/collection/date-buckets';
import {
  deduplicateItems,
  groupSoupEntities,
} from '@app/features/soup/collection/transforms';
import type { SoupGroup } from '@app/features/soup/collection/types';
import type { EntityWithRawNotifications } from '@app/features/soup/entity-notifications';
import { compareDateDesc, type DateValue } from '@core/util/date';
import type { EntityData } from '@entity';
import { homeDateBucket } from './home-date-buckets';
import {
  type InboxViewContext,
  inboxTabOrdersByNotification,
} from './inbox-query';

type InboxOrderContext = Pick<InboxViewContext, 'tab' | 'capabilities'>;

export const inboxSortTimestamp = (entity: EntityData) =>
  entity.sortTs ?? entity.updatedAt ?? entity.createdAt;

/**
 * The timestamp a row is bucketed on. Tabs served by the `notified_at` sort
 * bucket on the viewer's latest notification, matching the order the rows
 * arrive in; rows without a stamp (websocket inserts) and the other tabs fall
 * back to content recency.
 */
export const inboxGroupTimestamp = (
  entity: EntityData,
  context: InboxOrderContext
) =>
  (inboxTabOrdersByNotification(context) ? entity.notifiedAt : undefined) ??
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

const latestTimestamp = (
  first: DateValue | null | undefined,
  second: DateValue | null | undefined
) => (compareDateDesc(first, second) <= 0 ? first : second);

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
        .filter((entity) => entity.touchedAt)
        .map((entity) => ({
          ...entity,
          sortTs: entity.touchedAt,
        })),
    ],
    {
      getKey: (entity) => `${entity.type}:${entity.id}`,
      resolveConflict: (existing, incoming) => ({
        ...(compareDateDesc(
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
  ).sort(
    (a, b) =>
      compareDateDesc(a.sortTs, b.sortTs) ||
      a.type.localeCompare(b.type) ||
      a.id.localeCompare(b.id)
  );
}

/** Home uses its merged timestamp and finer intraday sections. */
export function groupHomeEntitiesByDate<T extends EntityData>(
  entities: T[],
  now: Date
): SoupGroup<T>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) => homeDateBucket(entity.sortTs, now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      homeDateBucket(firstEntity.sortTs, now).label,
  });
}
