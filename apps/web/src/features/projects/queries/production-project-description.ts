import { throwOnErr } from '@core/util/result';
import { fetchSyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import { createSyncServiceSource } from '@service-sync/source';
import { createProjectDescriptionSession } from './project-description';

/** Open the backing document the way Markdown detail does, without its block. */
export function createProductionProjectDescriptionSession(documentId: string) {
  return createProjectDescriptionSession(documentId, {
    authorize: (documentId) =>
      throwOnErr(() => fetchSyncDocumentOpenContext(documentId)),
    connect: (documentId, { token, authorization }) =>
      createSyncServiceSource(documentId, token, authorization),
  });
}
