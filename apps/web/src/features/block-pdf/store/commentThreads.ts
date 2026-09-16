import { createBlockMemo, useBlockId, useBlockName } from '@core/block';
import type { CommentId, IComment, ThreadId } from '@core/comments/commentType';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useMessageRootsQuery } from '@queries/messages/document-messages';
import type { MessageListItem } from '@service-storage/messages';
import { commentThreadsResource, sortComments } from './commentsResource';

/** A discussion that can attach to a PDF anchor, from either comment source. */
export type PdfCommentThread = {
  threadId: ThreadId;
  rootId: CommentId;
  /** The anchor a message-backed discussion names; legacy anchors name their thread instead. */
  anchorId: string | null;
  owner: string;
  comments: IComment[];
  replyCount?: number;
  isResolved: boolean;
};

const documentMessagesQuery = createBlockMemo(() => {
  if (
    useBlockName() !== 'pdf' ||
    !isFeatureEnabled(enableUnifiedDocumentDiscussions)
  )
    return;
  const id = useBlockId();
  return useMessageRootsQuery(() => ({ type: 'document', id }));
});

const documentMessageRoots = (): MessageListItem[] => {
  const query = documentMessagesQuery();
  return query?.isSuccess ? query.data : [];
};

function messageThread(root: MessageListItem): PdfCommentThread {
  const anchor = root.state.anchor;
  return {
    threadId: root.state.root_id,
    rootId: root.id,
    anchorId: anchor && anchor.type !== 'markdown' ? anchor.anchor_id : null,
    owner: root.state.user_id,
    comments: [root, ...root.thread.preview],
    replyCount: root.thread.reply_count,
    isResolved: root.state.resolved,
  };
}

export const pdfCommentThreads = createBlockMemo((): PdfCommentThread[] => {
  if (isFeatureEnabled(enableUnifiedDocumentDiscussions)) {
    return documentMessageRoots()
      .filter((root) => !root.state.deleted_at)
      .map(messageThread);
  }
  const [commentThreadsData] = commentThreadsResource;
  return (commentThreadsData() ?? []).map((thread) => {
    const comments = [...thread.comments].sort(sortComments);
    return {
      threadId: thread.thread.threadId,
      rootId: comments[0]?.commentId ?? thread.thread.threadId,
      anchorId: null,
      owner: thread.thread.owner,
      comments,
      isResolved: thread.thread.resolved,
    };
  });
});

/**
 * Legacy anchors store a numeric thread id. Anchors of a shared discussion
 * store the root id instead, and the discussion names the anchor uuid back.
 */
export function findAnchorThread(
  threads: readonly PdfCommentThread[],
  anchor: { uuid: string; threadId?: number | null; rootId?: string | null }
): PdfCommentThread | undefined {
  return threads.find(
    (thread) =>
      (anchor.threadId != null && thread.threadId === anchor.threadId) ||
      (anchor.rootId != null && thread.threadId === anchor.rootId) ||
      (thread.anchorId != null && thread.anchorId === anchor.uuid)
  );
}
