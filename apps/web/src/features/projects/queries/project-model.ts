import type { mapInitiativeDetail } from '@service-storage/initiative';
import type { ProjectDetail } from '../core/project';

export function toProjectDetail(
  project: ReturnType<typeof mapInitiativeDetail>
): ProjectDetail {
  return {
    id: project.id,
    name: project.name,
    descriptionSurfaceId: project.descriptionSurfaceId,
    updatedAt: project.updatedAt,
    ownerId: project.ownerId,
    memberIds: project.memberIds,
    taskIds: project.taskIds,
    access: project.userAccessLevel,
    createdAt: project.createdAt,
  };
}
