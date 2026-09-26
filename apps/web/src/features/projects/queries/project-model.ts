import type {
  mapInitiativeDetail,
  mapInitiativeSummary,
} from '@service-storage/initiative';
import type { Project, ProjectDetail } from '../core/project';

export function toProject(
  project: ReturnType<typeof mapInitiativeSummary>
): Project {
  return {
    id: project.id,
    name: project.name,
    descriptionDocumentId: project.descriptionDocumentId,
    updatedAt: project.updatedAt,
  };
}

export function toProjectDetail(
  project: ReturnType<typeof mapInitiativeDetail>
): ProjectDetail {
  return {
    ...toProject(project),
    ownerId: project.ownerId,
    memberIds: project.memberIds,
    taskIds: project.taskIds,
    access: project.userAccessLevel,
    createdAt: project.createdAt,
    sharing: project.sharePermission,
  };
}
