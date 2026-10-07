/**
 * Storing an edited `.fig` as a new version of its document.
 */

import { storageServiceClient } from '@service-storage/client';
import { FIG_MIME } from '../definition';

export async function saveFigFile(
  documentId: string,
  bytes: Uint8Array
): Promise<void> {
  const file = new Blob([bytes as BlobPart], { type: FIG_MIME });
  const result = await storageServiceClient.simpleSave({ documentId, file });
  if (result.isErr()) {
    const first = result.error[0];
    throw new Error(first?.message ?? 'The design could not be saved.');
  }
}
