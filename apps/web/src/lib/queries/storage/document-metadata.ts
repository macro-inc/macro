import { storageServiceClient } from '@service-storage/client';
import type { DocumentMetadata } from '@service-storage/generated/schemas';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityKeys } from './keys';

const STALE_TIME = 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

async function fetchDocumentMetadata(
  documentId: string
): Promise<DocumentMetadata> {
  const result = await storageServiceClient.getDocumentMetadata({ documentId });
  if (result.isErr()) {
    throw new Error('Failed to fetch document metadata');
  }
  return result.value.documentMetadata;
}

async function fetchDocumentAccessLevel(
  documentId: string
): Promise<AccessLevel> {
  const result = await storageServiceClient.getDocumentMetadata({ documentId });
  if (result.isErr()) {
    throw new Error('Failed to fetch document access level');
  }
  return result.value.userAccessLevel;
}

export function useDocumentMetadataQuery(documentId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: entityKeys.documentMetadata(documentId()).queryKey,
    queryFn: () => fetchDocumentMetadata(documentId()),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!documentId(),
  }));
}

/** Loads the current user's access level for a document. */
export function useDocumentAccessLevelQuery(documentId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: entityKeys.documentAccessLevel(documentId()).queryKey,
    queryFn: () => fetchDocumentAccessLevel(documentId()),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!documentId(),
  }));
}
