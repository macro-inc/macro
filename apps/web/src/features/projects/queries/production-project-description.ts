import { getCollabSurfaceToken } from '@core/collab-surface/token';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { initiativeClient } from '@service-storage/initiative';
import { createCollabSurfaceSource } from '@service-sync/source';
import { createProjectDescriptionSession } from './project-description';

/**
 * How long to keep asking while a new project's description document finishes
 * initializing in the background, matching the document open path's wait.
 */
const PREPARE_TIMEOUT_MS = 15_000;
const PREPARE_INITIAL_DELAY_MS = 250;
const PREPARE_MAX_DELAY_MS = 1_000;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

/**
 * Ensure the project's description surface, retrying while the backend reports that the
 * description document's session is still being prepared (`CONFLICT`). Any other error, or
 * a session that never appears within the budget, fails at once.
 */
async function ensureDescriptionSurface(
  projectId: string,
  signal: AbortSignal
): Promise<void> {
  const deadline = Date.now() + PREPARE_TIMEOUT_MS;
  let delay = PREPARE_INITIAL_DELAY_MS;
  for (;;) {
    try {
      await throwOnErr(() =>
        initiativeClient.ensureDescriptionSurface(projectId)
      );
      return;
    } catch (error) {
      if (
        !thrownResultErrorHasCode(error, 'CONFLICT') ||
        Date.now() + delay > deadline
      )
        throw error;
    }
    await wait(delay, signal);
    delay = Math.min(delay * 2, PREPARE_MAX_DELAY_MS);
  }
}

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
    authorize: async (surfaceId, signal) => {
      await ensureDescriptionSurface(project.projectId, signal);
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
