/**
 * Creating a new Photoshop document: 1920 × 1080 with a white Background,
 * as Photoshop's default "Web" preset is laid out.
 */

import { analytics } from '@app/lib/analytics';
import { PsdEngine } from '@core/psd-engine/client';
import { contentHash } from '@core/util/hash';
import { invalidateUserQuota } from '@queries/auth';
import { postNewHistoryItem } from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { storageServiceClient } from '@service-storage/client';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { PSD_MIME } from '../definition';

/** The size of a new document. */
export const NEW_DOCUMENT = { width: 1920, height: 1080 };

export async function createPsdDocument(args: {
  title?: string;
  projectId?: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
}): Promise<string | undefined> {
  const title = args.title ?? 'Untitled image';
  const bytes = await PsdEngine.blank(
    NEW_DOCUMENT.width,
    NEW_DOCUMENT.height,
    true
  );
  const sha = await contentHash(bytes);
  const created = await storageServiceClient.createDocument({
    documentName: title,
    fileType: 'psd',
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
    type: PSD_MIME,
  });
  if (upload.isErr()) return undefined;
  const documentId = doc.metadata.documentId;
  postNewHistoryItem('document', documentId);
  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: title,
    fileType: 'psd',
  });
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });
  analytics.track('create_entity', {
    entityType: 'psd',
    entityId: documentId,
    projectId: args.projectId,
    source: args.source,
  });
  return documentId;
}
