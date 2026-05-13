import type { FetchError } from '@core/service';
import {
  isErr,
  type MaybeResult,
  maybeThrow,
  ok,
} from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import type { GetDocumentResponseData } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { waitForDocumentPresignedUrlReady } from './document-location';
import { binaryDocumentKeys } from './keys';

const BINARY_DOCUMENT_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const BINARY_DOCUMENT_GC_TIME = 10 * 60 * 1000; // 10 minutes

type BinaryDocumentData = GetDocumentResponseData & { blobUrl: string };
type BinaryDocumentError = FetchError | 'INVALID_DOCUMENT';

export async function fetchBinaryDocumentData(
  documentId: string
): Promise<MaybeResult<BinaryDocumentError, BinaryDocumentData>> {
  const maybeDocument = await storageServiceClient.getDocumentMetadata({
    documentId,
  });
  if (isErr(maybeDocument)) return maybeDocument;

  const [, documentData] = maybeDocument;
  const versionId = documentData.documentMetadata.documentVersionId;

  const location = await waitForDocumentPresignedUrlReady({
    documentId,
    versionId,
  }).catch((error) => {
    console.error('error waiting for binary document location', error);
    return undefined;
  });

  if (
    !location ||
    location.content.state !== 'ready' ||
    location.type !== 'presignedUrl' ||
    !location.presignedUrl
  ) {
    return [
      [
        {
          code: 'INVALID_DOCUMENT',
          message: 'Document location is not ready as a presigned URL',
        },
      ],
      null,
    ];
  }

  return ok({
    ...documentData,
    blobUrl: location.presignedUrl,
  });
}

async function fetchBinaryDocument(documentId: string): Promise<string> {
  const result = await fetchBinaryDocumentData(documentId);
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

export function invalidateBinaryDocument(documentId: string) {
  return queryClient.invalidateQueries({
    queryKey: binaryDocumentKeys.document(documentId).queryKey,
  });
}
