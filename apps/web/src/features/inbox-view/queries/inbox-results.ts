import {
  dateBucket,
  groupSoupEntities,
  type SoupGroup,
} from '@app/features/soup/collection';
import type { EntityData, WithNotification } from '@entity';
import type { InboxTab } from '../types';
import { inboxTabOrdersByNotification } from './inbox-query';

export const inboxSortTimestamp = (entity: EntityData) =>
  entity.sortTs ?? entity.updatedAt ?? entity.createdAt;

/**
 * The timestamp a row is bucketed on. Tabs served by the `notified_at` sort
 * bucket on the viewer's latest notification, matching the order the rows
 * arrive in; rows without a stamp (websocket inserts) and the other tabs fall
 * back to content recency.
 */
export const inboxGroupTimestamp = (entity: EntityData, tab: InboxTab) =>
  (inboxTabOrdersByNotification(tab) ? entity.notifiedAt : undefined) ??
  inboxSortTimestamp(entity);

export function groupInboxEntitiesByDate(
  entities: WithNotification<EntityData>[],
  tab: InboxTab,
  now = new Date()
): SoupGroup<WithNotification<EntityData>>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) =>
      dateBucket(inboxGroupTimestamp(entity, tab), now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      dateBucket(inboxGroupTimestamp(firstEntity, tab), now).label,
  });
}
