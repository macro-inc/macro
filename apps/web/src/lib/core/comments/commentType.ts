import type { DateValue } from '@core/util/date';
import type { Message, PostMessage } from '@service-storage/messages';

/**
 * Comments are messages with UUIDs; drafts carry numeric or prefixed sentinel
 * ids until the server assigns one.
 */
export type CommentId = string | number;
export type ThreadId = string | number;

/** Thread id of a comment being composed before the server assigns one. */
export const DRAFT_THREAD_ID = -1;

export function isDraftThreadId(id: ThreadId | null | undefined): boolean {
  return id === DRAFT_THREAD_ID;
}

/** Presentation fields of a comment message. */
export function commentView(comment: Message): {
  id: CommentId;
  createdAt: DateValue | null | undefined;
  owner: string;
  author: string;
  text: string;
  message?: Message;
} {
  return {
    id: comment.id,
    createdAt: comment.created_at,
    owner: comment.sender_id,
    author:
      comment.imported_author?.name?.trim() ||
      comment.sender?.name ||
      comment.sender_id,
    text: comment.content,
    message: comment,
  };
}

type CommentBase = {
  id: CommentId;
  rootId: CommentId;
  anchorId: string;
  // macro id of the comment owner
  owner: string;
  author: string;
  text: string;
  createdAt: DateValue | null | undefined;
  // TODO: deprecated, adding for type compatibility
  resolved?: boolean;
  /** The shared message behind this comment; absent for drafts. */
  message?: Message;
};

type ThreadedComment = CommentBase & {
  threadId: ThreadId;
  isNew: boolean;
};

export type Root = ThreadedComment & {
  children: CommentId[];
  /** Total live replies; children holds only the loaded preview. */
  replyCount?: number;
};

export type Reply = ThreadedComment & {};

export type Layout = {
  calculatedYPos: number;
};

/** Comment writes through the shared message API; a draft thread posts a new root. */
export type MessageCommentOperations = {
  createComment: (
    input: Omit<PostMessage, 'thread_id'> & { threadId: ThreadId }
  ) => Promise<Message | null>;
};

export function isRoot(comment: Root | Reply): comment is Root {
  return comment.id === comment.rootId;
}
