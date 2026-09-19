import { analytics } from '@app/lib/analytics';
import { contentHash } from '@core/util/hash';
import { invalidateUserQuota } from '@queries/auth';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { storageServiceClient } from '@service-storage/client';
import { isSpreadsheetEnabledForCurrentUser } from './spreadsheet-access';

export async function createSpreadsheetDocument(args?: {
  title?: string;
  projectId?: string;
  source?: string;
}): Promise<string | undefined> {
  if (!isSpreadsheetEnabledForCurrentUser()) return;
  const title = args?.title ?? 'Untitled spreadsheet';
  const created = await storageServiceClient.createSpreadsheetDocument({
    documentName: title,
    projectId: args?.projectId,
    sha: await contentHash(new Uint8Array()),
  });
  invalidateUserQuota();
  if (created.isErr()) return;

  const documentId = created.value.metadata.documentId;
  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: title,
    fileType: 'spreadsheet',
  });
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });
  analytics.track('create_entity', {
    entityType: 'spreadsheet',
    entityId: documentId,
    projectId: args?.projectId,
    source: args?.source,
  });
  return documentId;
}
