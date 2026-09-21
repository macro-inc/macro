import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';

export async function saveCodeDocument(
  documentId: string,
  text: string
): Promise<void> {
  await throwOnErr(() =>
    storageServiceClient.simpleSave({
      documentId,
      file: new Blob([text], { type: 'text/plain' }),
    })
  );
}
