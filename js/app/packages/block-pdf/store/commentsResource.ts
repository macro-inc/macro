import type { IHighlight } from '@block-pdf/model/Highlight';
import type { IThreadPlaceable } from '@block-pdf/type/placeables';
import {
  createBlockMemo,
  createBlockResource,
  useBlockId,
  useBlockName,
} from '@core/block';
import { isErr } from '@core/util/maybeResult';
import { createConnectionBlockWebsocketEffect } from '@service-connection/websocket';
import { useUserId } from '@service-gql/client';
import { storageServiceClient } from '@service-storage/client';
import type { AnnotationIncrementalUpdate } from '@service-storage/generated/schemas/annotationIncrementalUpdate';
import type { Comment } from '@service-storage/generated/schemas/comment';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import type { CreateCommentRequest } from '@service-storage/generated/schemas/createCommentRequest';
import type { CreateCommentRequestAnchor } from '@service-storage/generated/schemas/createCommentRequestAnchor';
import type { CreateCommentResponse } from '@service-storage/generated/schemas/createCommentResponse';
import type { CreateUnthreadedAnchorRequest } from '@service-storage/generated/schemas/createUnthreadedAnchorRequest';
import type { CreateUnthreadedAnchorResponse } from '@service-storage/generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteCommentRequest } from '@service-storage/generated/schemas/deleteCommentRequest';
import type { DeleteCommentResponse } from '@service-storage/generated/schemas/deleteCommentResponse';
import type { DeleteUnthreadedAnchorRequest } from '@service-storage/generated/schemas/deleteUnthreadedAnchorRequest';
import type { DeleteUnthreadedAnchorResponse } from '@service-storage/generated/schemas/deleteUnthreadedAnchorResponse';
import type { EditAnchorRequest } from '@service-storage/generated/schemas/editAnchorRequest';
import type { EditAnchorResponse } from '@service-storage/generated/schemas/editAnchorResponse';
import type { EditCommentRequest } from '@service-storage/generated/schemas/editCommentRequest';
import type { EditCommentResponse } from '@service-storage/generated/schemas/editCommentResponse';
import { batch } from 'solid-js';

const isPdfBlock = createBlockMemo(() => useBlockName() === 'pdf');
export const commentThreadsResource = createBlockResource(
  isPdfBlock,
  fetchComments
);
export const anchorsResource = createBlockResource(isPdfBlock, fetchAnchors);

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

async function fetchAnchors() {
  const documentId = useBlockId();
  const anchors = await storageServiceClient.annotations.getAnchors({
    documentId,
  });
  return anchors[1]?.data ?? [];
}

function useHandleCreateUnthreadedAnchor() {
  const [, { mutate: mutateAnchors }] = anchorsResource;

  return async (response: CreateUnthreadedAnchorResponse) => {
    mutateAnchors((prev) => [...prev, response]);
  };
}

function useCreateUnthreadedAnchor() {
  const documentId = useBlockId();
  const handleCreateUnthreadedAnchor = useHandleCreateUnthreadedAnchor();

  return async (body: CreateUnthreadedAnchorRequest) => {
    const maybeResult = await storageServiceClient.annotations.createAnchor({
      documentId,
      body,
    });

    if (isErr(maybeResult)) {
      console.error('Unable to create anchor');
      return false;
    }

    const [, response] = maybeResult;

    handleCreateUnthreadedAnchor(response);

    return true;
  };
}

function useHandleDeleteUnthreadedAnchor() {
  const [, { mutate: mutateAnchors }] = anchorsResource;
  const [, { mutate: mutateCommentThreads }] = commentThreadsResource;

  return async (response: DeleteUnthreadedAnchorResponse) => {
    mutateAnchors((prev) => prev.filter((a) => a.uuid !== response.uuid));
    if (response.threadId != null) {
      mutateCommentThreads((prev) =>
        prev.filter((t) => t.thread.threadId !== response.threadId)
      );
    }
  };
}

function useDeleteUnthreadedAnchor() {
  const handleDeleteUnthreadedAnchor = useHandleDeleteUnthreadedAnchor();

  return async (body: DeleteUnthreadedAnchorRequest) => {
    const maybeResult = await storageServiceClient.annotations.deleteAnchor({
      body,
    });

    if (isErr(maybeResult)) {
      console.error('Unable to delete anchor');
      return false;
    }

    const [, response] = maybeResult;

    handleDeleteUnthreadedAnchor(response);

    return true;
  };
}

function useHandleEditAnchor() {
  const [, { mutate: mutateAnchors }] = anchorsResource;

  return async (response: EditAnchorResponse) => {
    mutateAnchors((prev) => [
      ...prev.filter((a) => a.uuid !== response.uuid),
      response,
    ]);
  };
}

function useEditAnchor() {
  const handleEditAnchor = useHandleEditAnchor();

  return async (body: EditAnchorRequest) => {
    const maybeResult = await storageServiceClient.annotations.editAnchor({
      body,
    });

    if (isErr(maybeResult)) {
      console.error('Unable to edit anchor');
      return false;
    }

    const [, response] = maybeResult;

    handleEditAnchor(response);

    return true;
  };
}

function useHandleCreateComment() {
  const [, { mutate: mutateCommentThreads }] = commentThreadsResource;
  const [, { mutate: mutateAnchors }] = anchorsResource;

  return async (response: CreateCommentResponse) => {
    const commentThread: CommentThread = {
      thread: response.thread,
      comments: response.comments,
    };
    const retAnchor = response.anchor;
    batch(() => {
      if (retAnchor) {
        mutateAnchors((prev) => [...prev, retAnchor]);
      }

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
    if (body.threadId == null && body.anchor == null) {
      console.error('Provide either a thread or anchor for creating a comment');
      return null;
    }

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
  const [, { mutate: mutateAnchors }] = anchorsResource;

  return async (response: DeleteCommentResponse) => {
    batch(() => {
      // either delete single comment or entire thread
      if (response.thread.deleted) {
        mutateCommentThreads((prev) =>
          prev.filter((t) => t.thread.threadId !== response.thread.threadId)
        );
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
      }

      const deletedAnchor = response.anchor;
      if (!deletedAnchor) return;

      if (deletedAnchor.deleted) {
        mutateAnchors((prev) =>
          prev.filter((a) => a.uuid !== deletedAnchor.uuid)
        );
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
      return false;
    }

    const [, response] = maybeResult;

    handleDeleteComment(response);

    return true;
  };
}

export function useCreateFreeCommentResource() {
  const createComment = useCreateComment();

  return async (text: string, placeable: IThreadPlaceable) => {
    let anchor: CreateCommentRequestAnchor | undefined;
    if (placeable) {
      anchor = {
        uuid: placeable.internalId,
        page: placeable.pageRange.values().next().value,
        fileType: 'pdf',
        anchorType: 'free-comment',
        // position info
        xPct: placeable.position.xPct,
        yPct: placeable.position.yPct,
        widthPct: placeable.position.widthPct,
        heightPct: placeable.position.heightPct,
        rotation: placeable.position.rotation,
        // TODO: deprecate
        originalIndex: placeable.originalIndex,
        originalPage: placeable.originalPage,
        wasDeleted: placeable.wasDeleted,
        wasEdited: placeable.wasEdited,
        allowableEdits: placeable.allowableEdits,
        shouldLockOnSave: placeable.shouldLockOnSave,
      };
    }
    const body: CreateCommentRequest = {
      text: text,
      threadId: undefined,
      anchor,
    };

    return createComment(body);
  };
}

export function useCreateHighlightCommentResource() {
  const createComment = useCreateComment();

  return async (text: string, highlight: IHighlight) => {
    let anchor: CreateCommentRequestAnchor | undefined;
    if (highlight) {
      if (highlight.pageViewport == null) {
        console.error('Highlight page viewport is null');
        return null;
      }

      anchor = {
        uuid: highlight.uuid,
        page: highlight.pageNum,
        fileType: 'pdf',
        anchorType: 'highlight',
        text: highlight.text,
        alpha: highlight.color.alpha ?? 1,
        blue: highlight.color.blue,
        red: highlight.color.red,
        green: highlight.color.green,
        highlightRects: highlight.rects,
        highlightType: 1,
        pageViewportHeight: highlight.pageViewport?.height ?? 0,
        pageViewportWidth: highlight.pageViewport?.width ?? 0,
      };
    }
    const body: CreateCommentRequest = {
      text: text,
      threadId: undefined,
      anchor,
    };

    return createComment(body);
  };
}

export function useAttachHighlightCommentResource() {
  const createComment = useCreateComment();

  return async (text: string, uuid: string) => {
    const body: CreateCommentRequest = {
      text: text,
      threadId: undefined,
      anchor: {
        fileType: 'pdf',
        anchorType: 'attachment',
        attachmentType: 'highlight',
        uuid,
      },
    };

    return createComment(body);
  };
}

export function useCreateUnthreadedHighlightResource() {
  const createAnchor = useCreateUnthreadedAnchor();

  return async (highlight: IHighlight) => {
    let anchor: CreateUnthreadedAnchorRequest;
    if (highlight.pageViewport == null) {
      console.error('Highlight page viewport is null');
      return false;
    }

    anchor = {
      uuid: highlight.uuid,
      page: highlight.pageNum,
      fileType: 'pdf',
      anchorType: 'highlight',
      text: highlight.text,
      alpha: highlight.color.alpha ?? 1,
      blue: highlight.color.blue,
      red: highlight.color.red,
      green: highlight.color.green,
      highlightRects: highlight.rects,
      highlightType: 1,
      pageViewportHeight: highlight.pageViewport?.height ?? 0,
      pageViewportWidth: highlight.pageViewport?.width ?? 0,
    };

    return createAnchor(anchor);
  };
}

export function useDeleteUnthreadedHighlightResource() {
  const deleteAnchor = useDeleteUnthreadedAnchor();

  return async (uuid: string) => {
    return deleteAnchor({
      fileType: 'pdf',
      anchorType: 'highlight',
      uuid,
    });
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

export function useEditPdfFreeCommentAnchor() {
  const editAnchor = useEditAnchor();

  return async (
    uuid: string,
    update: {
      xPct: number;
      yPct: number;
      widthPct: number;
      heightPct: number;
      page?: number;
    }
  ) => {
    const body: EditAnchorRequest = {
      xPct: update.xPct,
      yPct: update.yPct,
      widthPct: update.widthPct,
      heightPct: update.heightPct,
      page: update.page,
      originalPage: update.page,
      uuid,
      fileType: 'pdf',
      anchorType: 'free-comment',
    };
    return editAnchor(body);
  };
}

createConnectionBlockWebsocketEffect((msg) => {
  const currentUserId = useUserId();
  const currentDocumentId = useBlockId();
  const blockName = useBlockName();

  const handleCommentUpdate = useHandleCreateComment();
  const handleCreateUnthreadedAnchor = useHandleCreateUnthreadedAnchor();
  const handleEditComment = useHandleEditComment();
  const handleEditAnchor = useHandleEditAnchor();
  const handleDeleteComment = useHandleDeleteComment();
  const handleDeleteUnthreadedAnchor = useHandleDeleteUnthreadedAnchor();

  if (blockName !== 'pdf') return;

  if (msg.type === 'comment') {
    let incrementalUpdate: AnnotationIncrementalUpdate;
    try {
      incrementalUpdate = JSON.parse(msg.data) as AnnotationIncrementalUpdate;
      if (
        incrementalUpdate.payload.documentId !== currentDocumentId ||
        incrementalUpdate.payload.sender === currentUserId()
      ) {
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
        handleCreateUnthreadedAnchor(incrementalUpdate.payload.response);
        break;
      case 'edit-comment':
        handleEditComment(incrementalUpdate.payload.response);
        break;
      case 'edit-anchor':
        handleEditAnchor(incrementalUpdate.payload.response);
        break;
      case 'delete-comment':
        handleDeleteComment(incrementalUpdate.payload.response);
        break;
      case 'delete-anchor':
        handleDeleteUnthreadedAnchor(incrementalUpdate.payload.response);
        break;
      default:
        console.error('unknown comment update type', msg);
        break;
    }
  }
});
