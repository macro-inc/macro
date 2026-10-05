/**
 * Creating a new, empty design document.
 */

import { analytics } from '@app/lib/analytics';
import { FigEngine } from '@core/fig-engine/client';
import { contentHash } from '@core/util/hash';
import { invalidateUserQuota } from '@queries/auth';
import { postNewHistoryItem } from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { storageServiceClient } from '@service-storage/client';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { FIG_MIME } from '../definition';

export async function createFigDocument(args: {
  title?: string;
  projectId?: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
}): Promise<string | undefined> {
  const title = args.title ?? 'Untitled design';
  const bytes = await FigEngine.blank(title);
  const sha = await contentHash(bytes);
  const created = await storageServiceClient.createDocument({
    documentName: title,
    fileType: 'fig',
    sha,
    projectId: args.projectId,
  });
  invalidateUserQuota();
  if (created.isErr()) return undefined;
  const doc = created.value;
  const upload = await uploadToPresignedUrl({
    presignedUrl: doc.presignedUrl,
    buffer: bytes,
    sha,
    type: FIG_MIME,
  });
  if (upload.isErr()) return undefined;
  const documentId = doc.metadata.documentId;
  postNewHistoryItem('document', documentId);
  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: title,
    fileType: 'fig',
  });
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });
  analytics.track('create_entity', {
    entityType: 'fig',
    entityId: documentId,
    projectId: args.projectId,
    source: args.source,
  });
  return documentId;
}
