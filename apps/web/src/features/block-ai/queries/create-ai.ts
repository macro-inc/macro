/**
 * Creating a new Illustrator document: one empty artboard.
 */

import { analytics } from '@app/lib/analytics';
import { AiEngine } from '@core/ai-engine/client';
import { contentHash } from '@core/util/hash';
import { invalidateUserQuota } from '@queries/auth';
import { postNewHistoryItem } from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { storageServiceClient } from '@service-storage/client';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { NEW_ARTBOARD } from '../core/new-document';
import { AI_MIME } from '../definition';

export async function createAiDocument(args: {
  title?: string;
  projectId?: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
}): Promise<string | undefined> {
  const title = args.title ?? 'Untitled illustration';
  const bytes = await AiEngine.blank(NEW_ARTBOARD.width, NEW_ARTBOARD.height);
  const sha = await contentHash(bytes);
  const created = await storageServiceClient.createDocument({
    documentName: title,
    fileType: 'ai',
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
    type: AI_MIME,
  });
  if (upload.isErr()) return undefined;
  const documentId = doc.metadata.documentId;
  postNewHistoryItem('document', documentId);
  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: title,
    fileType: 'ai',
  });
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });
  analytics.track('create_entity', {
    entityType: 'ai',
    entityId: documentId,
    projectId: args.projectId,
    source: args.source,
  });
  return documentId;
}
