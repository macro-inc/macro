import {
  dateBucket,
  groupSoupEntities,
  type SoupGroup,
} from '@app/features/soup/collection';
import type { EntityData, WithNotification } from '@entity';
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
  now = new Date()
): SoupGroup<WithNotification<EntityData>>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) =>
      dateBucket(inboxGroupTimestamp(entity, context), now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      dateBucket(inboxGroupTimestamp(firstEntity, context), now).label,
  });
}
