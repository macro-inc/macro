import type { Comment } from '@service-storage/generated/schemas/comment';
import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';

export type IComment = Comment;
export type CommentId = number;
export type ThreadId = number;

type CommentBase = {
  id: number;
  rootId: number;
  anchorId: string;
  // macro id of the comment owner
  owner: string;
  author: string;
  text: string;
  createdAt: number;
  // TODO: deprecated, adding for type compatibility
  resolved?: boolean;
};

type ThreadedComment = CommentBase & {
  threadId: number;
  isNew: boolean;
};

export type Root = ThreadedComment & {
  children: number[];
};

export type Reply = ThreadedComment & {};

export type CreateCommentInfo = {
  threadId: number;
  text: string;
};

export type UpdateCommentInfo = {
  commentId: number;
  text: string;
};

export type DeleteCommentInfo = {
  commentId: number;
  removeAnchorThreadOnly?: boolean;
};

export type Layout = {
  calculatedYPos: number;
};

export type CommentOperations = {
  createComment: (
    info: CreateCommentInfo
  ) => Promise<CreateCommentResponse | null>;
  deleteComment: (info: DeleteCommentInfo) => Promise<boolean> | undefined;
  updateComment: (info: UpdateCommentInfo) => Promise<boolean>;
};

export function isRoot(comment: Root | Reply): comment is Root {
  return comment.id === comment.rootId;
}
