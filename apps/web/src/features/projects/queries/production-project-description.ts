import { getCollabSurfaceToken } from '@core/collab-surface/token';
import { throwOnErr } from '@core/util/result';
import { initiativeClient } from '@service-storage/initiative';
import { createCollabSurfaceSource } from '@service-sync/source';
import { createProjectDescriptionSession } from './project-description';

/**
 * Open a project's description surface, which has the project's id. The project domain
 * ensures the surface first; access then derives from project access.
 */
export function createProductionProjectDescriptionSession(projectId: string) {
  return createProjectDescriptionSession(projectId, {
    authorize: async (surfaceId, signal) => {
      await throwOnErr(() =>
        initiativeClient.ensureDescriptionSurface(surfaceId)
      );
      signal.throwIfAborted();
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
