import { throwOnErr } from '@core/util/result';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { fetchBinary } from '@service-storage/util/fetchBinary';

export type CanvasDocumentData = {
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  file: Blob;
};

export async function loadCanvasDocument(
  documentId: string
): Promise<CanvasDocumentData> {
  const data = await throwOnErr(() => fetchBinaryDocumentData(documentId));
  const file = await throwOnErr(() => fetchBinary(data.blobUrl, 'blob'));

  return {
    documentMetadata: data.documentMetadata,
    userAccessLevel: data.userAccessLevel,
    file,
  };
}
