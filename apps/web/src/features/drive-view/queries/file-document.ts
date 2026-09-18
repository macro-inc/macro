import { throwOnErr } from '@core/util/result';
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
  onProgress?: (progress: FetchProgress) => void;
};

export async function loadFileDocumentData(
  documentId: string
): Promise<FileDocumentData> {
  return throwOnErr(() =>
    storageServiceClient.getDocumentMetadata({ documentId })
  );
}

export function getFileDocumentUrl(data: {
  documentId: string;
  documentVersionId: number;
}): Promise<string> {
  return getPresignedUrl({
    documentId: data.documentId,
    versionId: data.documentVersionId,
  });
}

export async function getFileDocumentBlob(
  data: {
    documentId: string;
    documentVersionId: number;
  },
  options?: GetFileBlobOptions
): Promise<Blob> {
  const url = await getFileDocumentUrl(data);
  return throwOnErr(() =>
    options?.onProgress
      ? fetchPresignedBlobWithProgress(url, options.onProgress)
      : fetchPresigned(url, 'blob')
  );
}
