import { getCollabSurfaceToken } from '@core/collab-surface/token';
import { throwOnErr } from '@core/util/result';
import { initiativeClient } from '@service-storage/initiative';
import { createCollabSurfaceSource } from '@service-sync/source';
import { createProjectDescriptionSession } from './project-description';

/**
 * Open a project's description surface, which has the project's id. A signed-in
 * viewer has the project domain ensure the surface first; a caller with no
 * account cannot create one and reads the surface as it stands. Access then
 * derives from project access, read-only without an account.
 */
export function createProductionProjectDescriptionSession(
  projectId: string,
  options: { signedIn: boolean }
) {
  return createProjectDescriptionSession(projectId, {
    authorize: async (surfaceId, signal) => {
      if (options.signedIn) {
        await throwOnErr(() =>
          initiativeClient.ensureDescriptionSurface(surfaceId)
        );
        signal.throwIfAborted();
      }
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
