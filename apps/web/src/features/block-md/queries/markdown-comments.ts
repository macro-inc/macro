import { createQueryKeys } from '@lukemorales/query-key-factory';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

const MARKDOWN_COMMENTS_STALE_TIME = 60 * 1000;

export const markdownCommentKeys = createQueryKeys('markdown-comments', {
  document: (documentId: string) => [documentId],
});

async function fetchMarkdownComments(documentId: string) {
  const commentThreads = await storageServiceClient.annotations.getComments({
    documentId,
  });
  if (commentThreads.isErr()) {
    throw new Error('Unable to fetch comments');
  }
  return commentThreads.value.data;
}

export function useMarkdownCommentsQuery(documentId: Accessor<string>) {
  return useQuery(() => {
    const id = documentId();
    return {
      queryKey: markdownCommentKeys.document(id).queryKey,
      queryFn: () => fetchMarkdownComments(id),
      staleTime: MARKDOWN_COMMENTS_STALE_TIME,
    };
  });
}
