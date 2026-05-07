import { isErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import type { DocumentMetadata } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityKeys } from './keys';

const STALE_TIME = 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

async function fetchDocumentMetadata(
  documentId: string
): Promise<DocumentMetadata> {
  const result = await storageServiceClient.getDocumentMetadata({ documentId });
  if (isErr(result)) {
    throw new Error('Failed to fetch document metadata');
  }
  return result[1].documentMetadata;
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
