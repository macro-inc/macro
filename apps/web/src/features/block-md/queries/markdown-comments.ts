import { storageServiceClient } from '@service-storage/client';

export async function fetchMarkdownComments(documentId: string) {
  const commentThreads = await storageServiceClient.annotations.getComments({
    documentId,
  });
  if (commentThreads.isErr()) {
    throw new Error('Unable to fetch comments');
  }
  return commentThreads.value.data;
}
