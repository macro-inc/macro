import { analytics } from '@app/lib/analytics';
import { contentHash } from '@core/util/hash';
import { Telemetry } from '@macro-inc/observability';
import { invalidateUserQuota } from '@queries/auth';
import { postNewHistoryItem } from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { storageServiceClient } from '@service-storage/client';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import {
  DESMOS_MIME,
  emptyDesmosDocument,
  serializeDesmosDocument,
} from '../core/document';

export async function createDesmosDocument(args: {
  title?: string;
  projectId?: string;
  source?: string;
}): Promise<string | undefined> {
  return Telemetry.span('desmos.create', async (span) => {
    const title = args.title ?? 'Untitled graph';
    const bytes = new TextEncoder().encode(
      serializeDesmosDocument(emptyDesmosDocument())
    );
    const sha = await contentHash(bytes);
    const created = await storageServiceClient.createDocument({
      documentName: title,
      fileType: 'desmos',
      sha,
      projectId: args.projectId,
    });
    invalidateUserQuota();
    if (created.isErr()) {
      span.setAttr('desmos.outcome', 'error');
      return undefined;
    }
    const doc = created.value;
    const upload = await uploadToPresignedUrl({
      presignedUrl: doc.presignedUrl,
      buffer: bytes,
      sha,
      type: DESMOS_MIME,
    });
    if (upload.isErr()) {
      span.setAttr('desmos.outcome', 'error');
      return undefined;
    }
    const documentId = doc.metadata.documentId;
    span.setAttr('document.id', documentId);
    postNewHistoryItem('document', documentId);
    setPreviewOnCreate({
      itemId: documentId,
      itemType: 'document',
      name: title,
      fileType: 'desmos',
    });
    refetchSoupEntity(documentId, 'document', {
      ownTouch: true,
      refreshGraphql: true,
    });
    analytics.track('create_entity', {
      entityType: 'desmos',
      entityId: documentId,
      projectId: args.projectId,
      source: args.source,
    });
    return documentId;
  });
}
