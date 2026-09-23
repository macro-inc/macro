import type {
  PdfReply,
  PdfRoot,
  ThreadPayload,
  ViewerCommentType,
} from '@block-pdf/type/comments';
import {
  commentView,
  isLegacyComment,
  isMessageComment,
} from '@core/comments/commentType';
import { sortComments } from '../commentsResource';

/** The root and loaded replies of an anchored discussion, in the shared comment shape. */
export function anchoredThread(
  type: ViewerCommentType,
  thread: ThreadPayload
): { root: PdfRoot; replies: PdfReply[] } | null {
  const messages = thread.comments.filter(isMessageComment);
  if (messages.length > 0) {
    const [rootMessage, ...replyMessages] = messages;
    const commentBase = {
      type,
      isNew: false,
      threadId: thread.threadId,
      rootId: thread.rootId,
      anchorId: thread.anchorId,
    };
    const replies: PdfReply[] = replyMessages.map((message) => ({
      ...commentBase,
      ...commentView(message),
    }));
    const root: PdfRoot = {
      ...commentBase,
      ...commentView(rootMessage),
      children: replies.map((reply) => reply.id),
      replyCount: thread.replyCount,
      resolved: thread.isResolved,
    };
    return { root, replies };
  }

  const comments = thread.comments.filter(isLegacyComment).sort(sortComments);

  const rootComment = comments[0];
  if (!rootComment) return null;

  const commentBase = {
    type,
    isNew: false,
    threadId: rootComment.threadId,
    rootId: rootComment.commentId,
    anchorId: thread.anchorId,
  };

  const replies: PdfReply[] = [];
  for (let i = 1; i < comments.length; i++) {
    const comment = comments[i];
    replies.push({
      ...commentBase,
      id: comment.commentId,
      createdAt: comment.createdAt,
      owner: comment.owner,
      author: comment.sender || comment.owner,
      text: comment.text,
    });
  }

  const root: PdfRoot = {
    ...commentBase,
    id: rootComment.commentId,
    createdAt: rootComment.createdAt,
    owner: rootComment.owner,
    author: rootComment.sender || rootComment.owner,
    text: rootComment.text,
    children: replies.map((r) => r.id),
  };

  return { root, replies };
}
