import type { DateValue } from '@core/util/date';
import type { Message, PostMessage } from '@service-storage/messages';

export type IComment = Message;
export type CommentId = string;
export type ThreadId = string;

/** Geometry and selection state around a shared message; drafts have no message. */
type CommentBase = {
  id: string;
  rootId: string;
  anchorId: string;
  owner: string;
  author: string;
  text: string;
  createdAt: DateValue | null | undefined;
  resolved?: boolean;
  message?: Message;
};

type ThreadedComment = CommentBase & {
  threadId: string;
  isNew: boolean;
};

export type Root = ThreadedComment & {
  children: string[];
  /** Total live replies; children contains only the currently loaded preview. */
  replyCount: number;
};
export type Reply = ThreadedComment;
export type DeleteCommentInfo = {
  commentId: string;
  removeAnchorThreadOnly?: boolean;
};
export type Layout = { calculatedYPos: number };
export type CommentOperations = {
  createComment: (
    input: PostMessage & { thread_id: string }
  ) => Promise<Message | null>;
};

export function isRoot(comment: Root | Reply): comment is Root {
  return comment.id === comment.rootId;
}
