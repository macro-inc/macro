import { analytics } from '@app/lib/analytics';
import { createBulkMoveToProjectDssEntityMutation } from '../queries/dss';
import type { EntityData } from '../types/entity';

/** Rejects when the move fails, for the caller to report. */
export function createMoveEntitiesToFolder(source: string) {
  const mutation = createBulkMoveToProjectDssEntityMutation();

  return async (
    entities: EntityData[],
    folder: { id: string; name: string }
  ) => {
    await mutation.mutateAsync({
      entities: entities.map((entity) => ({
        ...entity,
        name: entity.name || entity.id,
      })),
      project: folder,
    });

    for (const entity of entities) {
      analytics.track('update_entity', {
        entityType: entity.type,
        entityId: entity.id,
        property: 'parent_project',
        newProjectId: folder.id,
        isBulk: entities.length > 1,
        bulkCount: entities.length,
        source,
      });
    }
  };
}
