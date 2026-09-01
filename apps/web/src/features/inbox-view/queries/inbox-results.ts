import {
  dateBucket,
  groupSoupEntities,
  type SoupGroup,
} from '@app/features/soup/collection';
import type { EntityData, WithNotification } from '@entity';

export const inboxSortTimestamp = (entity: EntityData) =>
  entity.sortTs ?? entity.updatedAt ?? entity.createdAt;

export function groupInboxEntitiesByDate(
  entities: WithNotification<EntityData>[],
  now = new Date()
): SoupGroup<WithNotification<EntityData>>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) => dateBucket(inboxSortTimestamp(entity), now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      dateBucket(inboxSortTimestamp(firstEntity), now).label,
  });
}
