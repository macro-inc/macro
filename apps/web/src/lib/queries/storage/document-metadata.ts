import { storageServiceClient } from '@service-storage/client';
import type { DocumentMetadata } from '@service-storage/generated/schemas';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { queryOptions, useQueries, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityKeys } from './keys';

const STALE_TIME = 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

export async function fetchDocumentMetadata(
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

function documentMetadataQueryOptions(documentId: string) {
  return queryOptions({
    queryKey: entityKeys.documentMetadata(documentId).queryKey,
    queryFn: () => fetchDocumentMetadata(documentId),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!documentId,
  });
}

export function useDocumentMetadataQuery(documentId: Accessor<string>) {
  return useQuery(() => documentMetadataQueryOptions(documentId()));
}

/** Shared options keep single-document and collection access checks on the same cache key. */
export function documentAccessLevelQueryOptions(documentId: string) {
  return {
    queryKey: entityKeys.documentAccessLevel(documentId).queryKey,
    queryFn: () => fetchDocumentAccessLevel(documentId),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!documentId,
  };
}

function documentAccessLevelEntryQueryOptions(documentId: string) {
  return {
    ...documentAccessLevelQueryOptions(documentId),
    select: (accessLevel: AccessLevel) => ({ documentId, accessLevel }),
  };
}

/** Loads the current user's access level for a document. */
export function useDocumentAccessLevelQuery(documentId: Accessor<string>) {
  return useQuery(() => documentAccessLevelQueryOptions(documentId()));
}

/** One shared query per unique document, even when a board renders several occurrences. */
export function useDocumentAccessLevelsQuery(
  documentIds: Accessor<readonly string[]>
) {
  return useQueries(() => {
    const uniqueDocumentIds = [...new Set(documentIds())];

    return {
      queries: uniqueDocumentIds.map((documentId) =>
        documentAccessLevelEntryQueryOptions(documentId)
      ),
    };
  });
}
