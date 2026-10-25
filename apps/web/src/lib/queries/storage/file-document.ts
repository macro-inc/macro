import { throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { storageServiceClient } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import {
  type FetchProgress,
  fetchPresigned,
  fetchPresignedBlobWithProgress,
} from '@service-storage/util/fetchPresigned';
import { getPresignedUrl } from '@service-storage/util/presignedUrl';

export type FileDocumentData = {
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
};

export type GetFileBlobOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: FetchProgress) => void;
  span?: Span;
};

export async function loadFileDocumentData(
  documentId: string,
  options?: GetFileBlobOptions
): Promise<FileDocumentData> {
  return (options?.span ?? Telemetry).span('file.metadata', async (span) => {
    span.setAttr('document.id', documentId);
    try {
      return await throwOnErr(() =>
        storageServiceClient.getDocumentMetadata({
          documentId,
          init: { signal: options?.signal },
        })
      );
    } catch (error) {
      if (!options?.signal?.aborted) span.error(error);
      throw error;
    }
  });
}

export function getFileDocumentUrl(
  data: {
    documentId: string;
    documentVersionId: number;
  },
  parentSpan?: Span
): Promise<string> {
  return (parentSpan ?? Telemetry).span('file.location', async (span) => {
    span.setAttr('document.id', data.documentId);
    span.setAttr('document.version_id', data.documentVersionId);
    try {
      return await getPresignedUrl({
        documentId: data.documentId,
        versionId: data.documentVersionId,
      });
    } catch (error) {
      span.error(error);
      throw error;
    }
  });
}

export async function getFileDocumentBlob(
  data: {
    documentId: string;
    documentVersionId: number;
  },
  options?: GetFileBlobOptions
): Promise<Blob> {
  const url = await getFileDocumentUrl(data, options?.span);
  options?.signal?.throwIfAborted();
  return (options?.span ?? Telemetry).span('file.transfer', async (span) => {
    span.setAttr('document.id', data.documentId);
    span.setAttr('document.version_id', data.documentVersionId);
    try {
      const blob = await throwOnErr(() =>
        options?.onProgress
          ? fetchPresignedBlobWithProgress(url, options.onProgress, {
              signal: options.signal,
            })
          : fetchPresigned(url, 'blob', { signal: options?.signal })
      );
      span.setAttr('file.size', blob.size);
      return blob;
    } catch (error) {
      if (!options?.signal?.aborted) span.error(error);
      throw error;
    }
  });
}
