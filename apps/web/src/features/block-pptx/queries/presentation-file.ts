/**
 * Reading and writing the stored `.pptx` file of a document.
 */

import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { storageServiceClient } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Stores `bytes` as a new version of the document. */
export async function savePresentationFile(
  documentId: string,
  bytes: Uint8Array
): Promise<void> {
  const file = new Blob([bytes as BlobPart], { type: PPTX_MIME });
  const result = await storageServiceClient.simpleSave({ documentId, file });
  if (result.isErr()) {
    const first = result.error[0];
    throw new Error(first?.message ?? 'The presentation could not be saved.');
  }
}

/** Downloads the latest stored bytes of a document. */
export async function fetchPresentationFile(
  documentId: string
): Promise<ArrayBuffer> {
  const data = await fetchBinaryDocumentData(documentId);
  if (data.isErr()) throw new Error('The presentation could not be loaded.');
  const bytes = await fetchBinary(data.value.blobUrl, 'arraybuffer');
  if (bytes.isErr())
    throw new Error('The presentation could not be downloaded.');
  return bytes.value;
}
