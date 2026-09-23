import { storageServiceClient } from '@service-storage/client';
import type { CreateUnthreadedAnchorRequest } from '@service-storage/generated/schemas/createUnthreadedAnchorRequest';

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

export async function createPdfAnchor(
  documentId: string,
  body: CreateUnthreadedAnchorRequest
) {
  const result = await storageServiceClient.annotations.createAnchor({
    documentId,
    body,
  });
  if (result.isErr()) {
    console.error('Unable to create anchor');
    return null;
  }
  return result.value;
}
