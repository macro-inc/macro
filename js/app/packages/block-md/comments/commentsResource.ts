import {
  createBlockMemo,
  createBlockResource,
  useBlockId,
  useBlockName,
} from '@core/block';
import { isErr } from '@core/util/maybeResult';
import { createConnectionBlockWebsocketEffect } from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type { AnnotationIncrementalUpdate } from '@service-storage/generated/schemas/annotationIncrementalUpdate';
import type { Comment } from '@service-storage/generated/schemas/comment';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import type { CreateCommentRequest } from '@service-storage/generated/schemas/createCommentRequest';
import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';
import type { DeleteCommentRequest } from '@service-storage/generated/schemas/deleteCommentRequest';
import type { DeleteCommentResponse } from '@service-storage/generated/schemas/deleteCommentResponse';
import type { EditCommentRequest } from '@service-storage/generated/schemas/editCommentRequest';
import type { EditCommentResponse } from '@service-storage/generated/schemas/editCommentResponse';
import { batch } from 'solid-js';
import type { MarkId, ThreadMetadata } from './commentType';

const isMdBlock = createBlockMemo(() => useBlockName() === 'md');
export const commentThreadsResource = createBlockResource(
  isMdBlock,
  fetchComments
);

export const sortComments = (a: Comment, b: Comment) => {
  if (a.order != null && b.order != null) {
    return a.order - b.order;
  } else if (a.order != null) {
    return -1;
  } else if (b.order != null) {
    return 1;
  }
  return a.createdAt - b.createdAt;
};

async function fetchComments() {
  const documentId = useBlockId();
  const commentThreads = await storageServiceClient.annotations.getComments({
    documentId,
  });
  return commentThreads[1]?.data ?? [];
}

function useHandleCreateComment() {
  const [, { mutate: mutateCommentThreads }] = commentThreadsResource;

  return async (response: CreateCommentResponse) => {
    const commentThread: CommentThread = {
      thread: response.thread,
      comments: response.comments,
    };
    batch(() => {
      let mutatedExistingThread = false;
      mutateCommentThreads((prev) => {
        let out: CommentThread[] = [];
        for (const thread of prev) {
          if (thread.thread.threadId === commentThread.thread.threadId) {
            mutatedExistingThread = true;
            out.push(commentThread);
          } else {
            out.push(thread);
          }
        }
        if (!mutatedExistingThread) {
          out.push(commentThread);
        }
        return out;
      });
    });
  };
}

function useCreateComment() {
  const documentId = useBlockId();
  const handleCreateComment = useHandleCreateComment();

  return async (body: CreateCommentRequest) => {
    const maybeResult = await storageServiceClient.annotations.createComment({
      documentId,
      body,
    });

    if (isErr(maybeResult)) {
      console.error('Unable to create comment');
      return null;
    }

    const response = maybeResult[1];

    handleCreateComment(response);

    return response;
  };
}

function useHandleEditComment() {
  const [, { mutate: mutateCommentThreads }] = commentThreadsResource;

  return async (response: EditCommentResponse) => {
    mutateCommentThreads((prev) => {
      let out: CommentThread[] = [];
      for (const thread of prev) {
        if (thread.thread.threadId === response.threadId) {
          const commentThread = {
            thread: thread.thread,
            comments: thread.comments.map((comment) => {
              if (comment.commentId === response.commentId) {
                const editedComment: Comment = response;
                return editedComment;
              }
              return comment;
            }),
          };
          out.push(commentThread);
        } else {
          out.push(thread);
        }
      }
      return out;
    });
  };
}

export function useEditCommentResource() {
  const handleEditComment = useHandleEditComment();

  return async (commentId: number, body: EditCommentRequest) => {
    const maybeResult = await storageServiceClient.annotations.editComment({
      commentId,
      body,
    });

    if (isErr(maybeResult)) {
      console.error('Unable to edit comment');
      return false;
    }

    const [, response] = maybeResult;

    handleEditComment(response);

    return true;
  };
}

function useHandleDeleteComment() {
  const [, { mutate: mutateCommentThreads }] = commentThreadsResource;

  return async (response: DeleteCommentResponse) => {
    return batch(() => {
      // either delete single comment or entire thread
      if (response.thread.deleted) {
        mutateCommentThreads((prev) =>
          prev.filter((t) => t.thread.threadId !== response.thread.threadId)
        );
        return {
          threadDeleted: true,
        };
      } else {
        mutateCommentThreads((prev) => {
          let out: CommentThread[] = [];
          for (const commentThread of prev) {
            if (commentThread.thread.threadId === response.thread.threadId) {
              const comments = commentThread.comments.filter(
                (c) => c.commentId !== response.commentId
              );
              out.push({ thread: commentThread.thread, comments });
            } else {
              out.push(commentThread);
            }
          }
          return out;
        });
        return {
          threadDeleted: false,
        };
      }
    });
  };
}

export function useDeleteCommentResource() {
  const handleDeleteComment = useHandleDeleteComment();

  return async (commentId: number, body: DeleteCommentRequest) => {
    const maybeResult = await storageServiceClient.annotations.deleteComment({
      commentId,
      body,
    });

    if (isErr(maybeResult)) {
      console.error('Unable to delete comment');
      return;
    }

    const [, response] = maybeResult;

    return handleDeleteComment(response);
  };
}

export function useCreateHighlightCommentResource() {
  const createComment = useCreateComment();

  return async (text: string, markId: MarkId) => {
    const metadata: ThreadMetadata = {
      markId,
    };
    const body: CreateCommentRequest = {
      text: text,
      threadId: undefined,
      threadMetadata: metadata,
    };

    return createComment(body);
  };
}

export function useCreateThreadReplyResource() {
  const createComment = useCreateComment();

  return async (text: string, threadId: number) => {
    if (threadId < 0) {
      console.error('Provide a valid thread id');
      return null;
    }

    const body: CreateCommentRequest = {
      text: text,
      threadId,
    };

    return createComment(body);
  };
}

// TODO: enable for live updates when live collab is a thing
createConnectionBlockWebsocketEffect((msg) => {
  const currentDocumentId = useBlockId();
  const blockName = useBlockName();

  const handleCommentUpdate = useHandleCreateComment();
  const handleEditComment = useHandleEditComment();
  const handleDeleteComment = useHandleDeleteComment();

  if (blockName !== 'md') return;

  if (msg.type === 'comment') {
    let incrementalUpdate: AnnotationIncrementalUpdate;
    try {
      incrementalUpdate = JSON.parse(msg.data) as AnnotationIncrementalUpdate;
      if (incrementalUpdate.payload.documentId !== currentDocumentId) {
        return;
      }
    } catch (e) {
      console.warn('unable to parse annotation incremental update', e);
      return;
    }

    switch (incrementalUpdate.updateType) {
      case 'create-comment':
        handleCommentUpdate(incrementalUpdate.payload.response);
        break;
      case 'create-anchor':
        break;
      case 'edit-comment':
        handleEditComment(incrementalUpdate.payload.response);
        break;
      case 'edit-anchor':
        break;
      case 'delete-comment':
        handleDeleteComment(incrementalUpdate.payload.response);
        break;
      case 'delete-anchor':
        break;
      default:
        console.error('unknown comment update type', msg);
        break;
    }
  }
});
