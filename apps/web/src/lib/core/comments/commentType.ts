import type { DateValue } from '@core/util/date';
import type {
  CreateCommentRequest,
  EditCommentRequest,
} from '@service-storage/generated/schemas';
import type { Comment } from '@service-storage/generated/schemas/comment';
import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';
import type { Message, PostMessage } from '@service-storage/messages';

/**
 * Legacy annotation comments carry numeric ids; comments read through the
 * shared message API are messages with UUIDs. Both flow through the same
 * margin, drawer, and layout code until the legacy path is removed.
 */
export type IComment = Comment | Message;
export type CommentId = string | number;
export type ThreadId = string | number;

/** Thread id of a comment being composed before the server assigns one. */
export const DRAFT_THREAD_ID = -1;

export function isDraftThreadId(id: ThreadId | null | undefined): boolean {
  return id === DRAFT_THREAD_ID;
}

export function isMessageComment(comment: IComment): comment is Message {
  return 'sender_id' in comment;
}

export function isLegacyComment(comment: IComment): comment is Comment {
  return !isMessageComment(comment);
}

/** Presentation fields shared by both comment sources. */
export function commentView(comment: IComment): {
  id: CommentId;
  createdAt: DateValue | null | undefined;
  owner: string;
  author: string;
  text: string;
  message?: Message;
} {
  if (isMessageComment(comment)) {
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
  return {
    id: comment.commentId,
    createdAt: comment.createdAt,
    owner: comment.owner,
    author: comment.sender || comment.owner,
    text: comment.text,
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
  /** The shared message behind this comment; absent for legacy comments and drafts. */
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

export type DeleteCommentInfo = {
  commentId: CommentId;
  removeAnchorThreadOnly?: boolean;
};

export type Layout = {
  calculatedYPos: number;
};

export type CommentOperations = {
  createComment: (
    info: Omit<CreateCommentRequest, 'threadId'> & { threadId: ThreadId }
  ) => Promise<CreateCommentResponse | null>;
  deleteComment: (info: DeleteCommentInfo) => Promise<boolean> | undefined;
  updateComment: (
    commentId: CommentId,
    info: Omit<EditCommentRequest, 'threadId'> & { threadId: ThreadId }
  ) => Promise<boolean>;
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
