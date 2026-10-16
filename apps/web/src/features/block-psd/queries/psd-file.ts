/**
 * Storing an edited `.psd` as a new version of its document.
 */

import { storageServiceClient } from '@service-storage/client';
import { PSD_MIME } from '../definition';

export async function savePsdFile(
  documentId: string,
  bytes: Uint8Array
): Promise<void> {
  const file = new Blob([bytes as BlobPart], { type: PSD_MIME });
  const result = await storageServiceClient.simpleSave({ documentId, file });
  if (result.isErr()) {
    const first = result.error[0];
    throw new Error(first?.message ?? 'The document could not be saved.');
  }
}
