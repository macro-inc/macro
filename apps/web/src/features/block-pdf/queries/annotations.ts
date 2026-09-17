import { storageServiceClient } from '@service-storage/client';

export async function getPdfComments(documentId: string) {
  const result = await storageServiceClient.annotations.getComments({
    documentId,
  });
  return result.isOk() ? result.value.data : [];
}

export async function getPdfAnchors(documentId: string) {
  const result = await storageServiceClient.annotations.getAnchors({
    documentId,
  });
  return result.isOk() ? result.value.data : [];
}
