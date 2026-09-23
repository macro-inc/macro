import { platformFetch } from '@core/util/platformFetch';
import { storageServiceClient } from '@service-storage/client';

export async function fetchExportedDocx(documentId: string): Promise<Blob> {
  const result = await storageServiceClient.exportDocument({ documentId });
  if (result.isErr()) throw result.error;

  const response = await platformFetch(result.value.presigned_url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return new Blob([await response.arrayBuffer()], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
