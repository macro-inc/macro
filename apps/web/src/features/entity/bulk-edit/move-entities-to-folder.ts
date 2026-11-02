import { analytics } from '@app/lib/analytics';
import { Telemetry } from '@macro-inc/observability';
import { createBulkMoveToProjectDssEntityMutation } from '../queries/dss';
import type { EntityData } from '../types/entity';

/** Rejects when the move fails, for the caller to report. */
export function createMoveEntitiesToFolder(source: string) {
  const mutation = createBulkMoveToProjectDssEntityMutation();

  return (entities: EntityData[], folder: { id: string; name: string }) =>
    Telemetry.span('entity.move_to_folder', async (span) => {
      span.setAttr('folder.id', folder.id);
      span.setAttr('entity.count', entities.length);
      span.setAttr('move.source', source);

      try {
        await mutation.mutateAsync({
          entities: entities.map((entity) => ({
            ...entity,
            name: entity.name || entity.id,
          })),
          project: folder,
        });
      } catch (error) {
        span.setAttr('move.outcome', 'failed');
        span.error(error);
        throw error;
      }
      span.setAttr('move.outcome', 'moved');

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
    });
}
