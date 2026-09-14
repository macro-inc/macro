import {
  dateBucket,
  groupSoupEntities,
  type SoupGroup,
} from '@app/features/soup/collection';
import type { EntityData, WithNotification } from '@entity';

// Threads are listed by latest activity: `sortTs` is the server's stamp for
// that order, and rows that arrived outside the page (websocket inserts,
// search hits) fall back to the thread's own recency.
const emailSortTimestamp = (entity: EntityData) =>
  entity.sortTs ?? entity.updatedAt ?? entity.createdAt;

export function groupEmailEntitiesByDate(
  entities: WithNotification<EntityData>[],
  now = new Date()
): SoupGroup<WithNotification<EntityData>>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) => dateBucket(emailSortTimestamp(entity), now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      dateBucket(emailSortTimestamp(firstEntity), now).label,
  });
}
