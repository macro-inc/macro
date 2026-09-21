import { storageServiceClient } from '@service-storage/client';

export async function getPdfAnchors(documentId: string) {
  const result = await storageServiceClient.annotations.getAnchors({
    documentId,
  });
  return result.isOk() ? result.value.data : [];
}
