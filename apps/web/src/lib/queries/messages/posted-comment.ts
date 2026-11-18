import {
  entityMessagesClient,
  type MessageCursor,
} from '@service-storage/messages';
import { queryClient } from '../client';
import { messageKeys } from './keys';

/** Check the complete persisted root list, never the optimistic comment cache. */
async function fetchPostedComment(documentId: string, markId: string) {
  let cursor: MessageCursor | null | undefined;
  do {
    const page = await entityMessagesClient.list(
      { type: 'document', id: documentId },
      { anchored: true, limit: 100, cursor: cursor ?? undefined }
    );
    if (
      page.items.some(
        (root) =>
          root.state.anchor?.type === 'markdown' &&
          root.state.anchor.mark_id === markId
      )
    )
      return true;
    cursor = page.next_cursor;
  } while (cursor);
  return false;
}

export function postedCommentQueryOptions(documentId: string, markId: string) {
  return {
    queryKey: messageKeys.postedComment(documentId, markId).queryKey,
    queryFn: () => fetchPostedComment(documentId, markId),
    staleTime: 0,
    retry: false,
  };
}

export function hasPostedComment(documentId: string, markId: string) {
  return queryClient.fetchQuery(postedCommentQueryOptions(documentId, markId));
}
