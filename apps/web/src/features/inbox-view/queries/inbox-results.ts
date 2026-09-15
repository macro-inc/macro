import {
  dateBucket,
  groupSoupEntities,
  type SoupGroup,
} from '@app/features/soup/collection';
import type { DateValue } from '@core/util/date';
import type { EntityData, WithNotification } from '@entity';
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

export function groupInboxEntitiesByDate(
  entities: WithNotification<EntityData>[],
  context: InboxOrderContext,
  now = new Date(),
  getTimestamp: (entity: EntityData) => DateValue | null | undefined = (
    entity
  ) => inboxGroupTimestamp(entity, context)
): SoupGroup<WithNotification<EntityData>>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) => dateBucket(getTimestamp(entity), now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      dateBucket(getTimestamp(firstEntity), now).label,
  });
}

/** Merge notification recency with Activity's own-touch projection. `sortTs`
 * is the Home row's display/grouping timestamp; source stamps stay intact. */
export function mergeHomeEntities(
  notifications: WithNotification<EntityData>[],
  recents: WithNotification<EntityData>[],
  context: InboxOrderContext
): WithNotification<EntityData>[] {
  const key = (entity: EntityData) => `${entity.type}:${entity.id}`;
  const rows = new Map(
    notifications.map((entity) => [
      key(entity),
      { ...entity, sortTs: inboxGroupTimestamp(entity, context) },
    ])
  );

  for (const recent of recents) {
    // Optimistic inserts from other users must never enter own activity.
    if (!recent.touchedAt) continue;
    const notification = rows.get(key(recent));
    const sortTs =
      notification?.sortTs &&
      new Date(notification.sortTs).getTime() >
        new Date(recent.touchedAt).getTime()
        ? notification.sortTs
        : recent.touchedAt;
    rows.set(key(recent), {
      ...(notification ?? recent),
      touchedAt: recent.touchedAt,
      sortTs,
    });
  }

  return [...rows.values()].sort(
    (a, b) =>
      new Date(b.sortTs ?? 0).getTime() - new Date(a.sortTs ?? 0).getTime()
  );
}

/** Home uses its merged timestamp and finer intraday sections. */
export function groupHomeEntitiesByDate(
  entities: WithNotification<EntityData>[],
  now: Date
): SoupGroup<WithNotification<EntityData>>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) => homeDateBucket(entity.sortTs, now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      homeDateBucket(firstEntity.sortTs, now).label,
  });
}
