import { createBlockMemo } from '@core/block';
import { compareDateAsc } from '@core/util/date';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import {
  commentThreadsResource,
  sortComments,
  useCreateHighlightCommentResource,
  useCreateThreadReplyResource,
  useDeleteCommentResource,
  useEditCommentResource,
} from './commentsResource';
import type { ThreadMetadata } from './commentType';

export const DISCUSSION_MARK_PREFIX = 'DISCUSSION:';

function isDiscussionThread(ct: CommentThread): boolean {
  const meta = ct.thread.metadata as ThreadMetadata | undefined;
  return meta?.markId?.startsWith(DISCUSSION_MARK_PREFIX) ?? false;
}

export const discussionThreads = createBlockMemo(() => {
  const [data] = commentThreadsResource;
  const threads = data() ?? [];
  return threads
    .filter(isDiscussionThread)
    .sort((a, b) => compareDateAsc(a.thread.createdAt, b.thread.createdAt));
});

export { sortComments };

export function useCreateDiscussionThread() {
  const createHighlight = useCreateHighlightCommentResource();

  return async (text: string) => {
    const markId = `${DISCUSSION_MARK_PREFIX}${crypto.randomUUID()}`;
    return createHighlight(text, markId);
  };
}

export function useCreateDiscussionReply() {
  const createReply = useCreateThreadReplyResource();

  return async (text: string, threadId: number) => {
    return createReply({ text, threadId });
  };
}

export function useEditDiscussionComment() {
  return useEditCommentResource();
}

export function useDeleteDiscussionComment() {
  return useDeleteCommentResource();
}
