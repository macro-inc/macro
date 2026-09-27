import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { createSyncServiceSource } from '@service-sync/source';
import { createProjectDescriptionSession } from './project-description';

/** Join the backing document using its existing authorized collaboration transport. */
export function createProductionProjectDescriptionSession(documentId: string) {
  return createProjectDescriptionSession(documentId, {
    getToken: async (documentId) =>
      (
        await throwOnErr(() =>
          storageServiceClient.permissionsTokens.createPermissionToken({
            document_id: documentId,
          })
        )
      ).token,
    connect: createSyncServiceSource,
  });
}
