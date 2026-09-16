import {
  fetchDocumentLocation,
  waitForDocumentSyncServiceReady,
} from '@queries/storage/document-location';
import { fetchDocumentLoadBundle } from '@queries/storage/documentLoad/documentLoadBundle';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { createSyncServiceSource } from '@service-sync/source';
import { match } from 'ts-pattern';

export type TaskDocumentData = ReturnType<typeof createSyncServiceSource> & {
  metadata: DocumentMetadata;
  permissions: {
    canComment: boolean;
    canEdit: boolean;
    isOwner: boolean;
  };
};

export async function loadTaskDocument(
  documentId: string
): Promise<TaskDocumentData> {
  const [bundleResult, locationResult] = await Promise.all([
    fetchDocumentLoadBundle(documentId),
    fetchDocumentLocation({ documentId }),
  ]);

  if (bundleResult.isErr()) {
    throw new Error('Unable to load task metadata');
  }
  if (locationResult.isErr()) {
    throw new Error('Unable to load task content');
  }

  let location = locationResult.value;
  if (
    location.type === 'presignedUrl' &&
    location.content.state === 'pending'
  ) {
    location = await waitForDocumentSyncServiceReady({ documentId });
  }
  if (location.type !== 'syncServiceContent') {
    throw new Error('Task content is not available in sync-service');
  }

  const { documentMetadata, token, userAccessLevel } = bundleResult.value;
  const permissions = match(userAccessLevel)
    .with('owner', () => ({
      canComment: true,
      canEdit: true,
      isOwner: true,
    }))
    .with('edit', () => ({
      canComment: true,
      canEdit: true,
      isOwner: false,
    }))
    .with('comment', () => ({
      canComment: true,
      canEdit: false,
      isOwner: false,
    }))
    .with('view', () => ({
      canComment: false,
      canEdit: false,
      isOwner: false,
    }))
    .exhaustive();

  return {
    ...createSyncServiceSource(documentId, token),
    metadata: documentMetadata,
    permissions,
  };
}
