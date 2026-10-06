import type {
  PdfReply,
  PdfRoot,
  ThreadPayload,
  ViewerCommentType,
} from '@block-pdf/type/comments';
import { commentView } from '@core/comments/commentType';

/** The root and loaded replies of an anchored discussion, in the shared comment shape. */
export function anchoredThread(
  type: ViewerCommentType,
  thread: ThreadPayload
): { root: PdfRoot; replies: PdfReply[] } | null {
  const [rootMessage, ...replyMessages] = thread.comments;
  if (!rootMessage) return null;
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
