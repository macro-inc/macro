import { maybeThrow } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { binaryDocumentKeys } from './keys';

const BINARY_DOCUMENT_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const BINARY_DOCUMENT_GC_TIME = 10 * 60 * 1000; // 10 minutes

async function fetchBinaryDocument(documentId: string): Promise<string> {
  const result = await storageServiceClient.getBinaryDocument({ documentId });
  const data = maybeThrow(result);
  return data.blobUrl;
}

function binaryDocumentQueryOptions(documentId: string) {
  return {
    queryKey: binaryDocumentKeys.document(documentId).queryKey,
    queryFn: () => fetchBinaryDocument(documentId),
    staleTime: BINARY_DOCUMENT_STALE_TIME,
    gcTime: BINARY_DOCUMENT_GC_TIME,
    enabled: !!documentId,
  };
}

export function useBinaryDocumentQuery(documentId: Accessor<string>) {
  return useQuery(() => binaryDocumentQueryOptions(documentId()));
}
