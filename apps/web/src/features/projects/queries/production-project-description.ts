import {
  getCollabSurfaceToken,
  mintCollabSurfaceToken,
  type SurfaceTokenViewer,
} from '@core/collab-surface/token';
import { throwOnErr } from '@core/util/result';
import { initiativeClient } from '@service-storage/initiative';
import { createCollabSurfaceSource } from '@service-sync/source';
import { createProjectDescriptionSession } from './project-description';

/**
 * Open a project's description surface, which has the project's id, for
 * `viewer`. A signed-in viewer has the project domain ensure the surface
 * first; a caller with no account (`null`) cannot create one, reads the
 * surface as it stands, and finds no description where none was ever started.
 * Access then derives from project access, read-only without an account.
 */
export function createProductionProjectDescriptionSession(
  projectId: string,
  options: { viewer: SurfaceTokenViewer }
) {
  return createProjectDescriptionSession(projectId, {
    authorize: async (surfaceId, signal) => {
      if (options.viewer !== null) {
        await throwOnErr(() =>
          initiativeClient.ensureDescriptionSurface(surfaceId)
        );
        signal.throwIfAborted();
      }
      const minted = await mintCollabSurfaceToken(surfaceId, options.viewer);
      if ('token' in minted) return minted.token;
      if (minted.error === 'absent' && options.viewer === null) return;
      throw new Error('Could not open the project description.');
    },
    connect: (surfaceId, token) =>
      createCollabSurfaceSource(surfaceId, token, () =>
        getCollabSurfaceToken(surfaceId, options.viewer)
      ),
  });
}
