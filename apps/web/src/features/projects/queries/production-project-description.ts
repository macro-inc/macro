import { getCollabSurfaceToken } from '@core/collab-surface/token';
import { throwOnErr } from '@core/util/result';
import { initiativeClient } from '@service-storage/initiative';
import { createCollabSurfaceSource } from '@service-sync/source';
import { createProjectDescriptionSession } from './project-description';

/**
 * Open a project's description surface. The project domain ensures the surface first, so it
 * adopts the description document's session (and content) before anyone connects; access
 * then derives from project access.
 */
export function createProductionProjectDescriptionSession(project: {
  projectId: string;
  surfaceId: string;
}) {
  return createProjectDescriptionSession(project.surfaceId, {
    authorize: async (surfaceId) => {
      await throwOnErr(() =>
        initiativeClient.ensureDescriptionSurface(project.projectId)
      );
      const token = await getCollabSurfaceToken(surfaceId);
      if (!token) throw new Error('Could not open the project description.');
      return token;
    },
    connect: (surfaceId, token) =>
      createCollabSurfaceSource(surfaceId, token, () =>
        getCollabSurfaceToken(surfaceId)
      ),
  });
}
