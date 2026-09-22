import type { IHighlight } from '@block-pdf/model/Highlight';
import type { IThreadPlaceable } from '@block-pdf/type/placeables';
import { useUserId } from '@core/context/user';
import { compareDateAsc } from '@core/util/date';

import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type { AnnotationIncrementalUpdate } from '@service-storage/generated/schemas/annotationIncrementalUpdate';
import type { Comment } from '@service-storage/generated/schemas/comment';
import type { CreateCommentRequest } from '@service-storage/generated/schemas/createCommentRequest';
import type { CreateCommentRequestAnchor } from '@service-storage/generated/schemas/createCommentRequestAnchor';
import type { CreateCommentRequestMentions } from '@service-storage/generated/schemas/createCommentRequestMentions';
import type { CreateUnthreadedAnchorRequest } from '@service-storage/generated/schemas/createUnthreadedAnchorRequest';
import type { DeleteCommentRequest } from '@service-storage/generated/schemas/deleteCommentRequest';
import type { DeleteUnthreadedAnchorRequest } from '@service-storage/generated/schemas/deleteUnthreadedAnchorRequest';
import type { EditAnchorRequest } from '@service-storage/generated/schemas/editAnchorRequest';
import type { EditCommentRequest } from '@service-storage/generated/schemas/editCommentRequest';
import { usePdfDocument } from '../context/pdf-document-context';

export const sortComments = (a: Comment, b: Comment) => {
  if (a.order != null && b.order != null) {
    return a.order - b.order;
  } else if (a.order != null) {
    return -1;
  } else if (b.order != null) {
    return 1;
  }
  return compareDateAsc(a.createdAt, b.createdAt);
};

function useCreateUnthreadedAnchor() {
  const { annotations, documentId } = usePdfDocument();

  return async (body: CreateUnthreadedAnchorRequest) => {
    const result = await storageServiceClient.annotations.createAnchor({
      documentId: documentId(),
      body,
    });

    if (result.isErr()) {
      console.error('Unable to create anchor');
      return false;
    }

    const response = result.value;
    annotations.commands.applyCreatedAnchor(response);

    return true;
  };
}

function useDeleteUnthreadedAnchor() {
  const annotations = usePdfDocument().annotations;

  return async (body: DeleteUnthreadedAnchorRequest) => {
    const result = await storageServiceClient.annotations.deleteAnchor({
      body,
    });

    if (result.isErr()) {
      console.error('Unable to delete anchor');
      return false;
    }

    const response = result.value;
    annotations.commands.applyDeletedAnchor(response);

    return true;
  };
}

function useEditAnchor() {
  const annotations = usePdfDocument().annotations;

  return async (body: EditAnchorRequest) => {
    const result = await storageServiceClient.annotations.editAnchor({
      body,
    });

    if (result.isErr()) {
      console.error('Unable to edit anchor');
      return false;
    }

    const response = result.value;
    annotations.commands.applyEditedAnchor(response);

    return true;
  };
}

function useCreateComment() {
  const { annotations, documentId } = usePdfDocument();

  return async (body: CreateCommentRequest) => {
    if (body.threadId == null && body.anchor == null) {
      console.error('Provide either a thread or anchor for creating a comment');
      return null;
    }

    const result = await storageServiceClient.annotations.createComment({
      documentId: documentId(),
      body,
    });

    if (result.isErr()) {
      console.error('Unable to create comment');
      return null;
    }

    const response = result.value;
    annotations.commands.applyCreatedComment(response);

    return response;
  };
}

export function useEditCommentResource() {
  const annotations = usePdfDocument().annotations;

  return async (commentId: number, body: EditCommentRequest) => {
    const result = await storageServiceClient.annotations.editComment({
      commentId,
      body,
    });

    if (result.isErr()) {
      console.error('Unable to edit comment');
      return false;
    }

    const response = result.value;
    annotations.commands.applyEditedComment(response);

    return true;
  };
}

export function useDeleteCommentResource() {
  const annotations = usePdfDocument().annotations;

  return async (commentId: number, body: DeleteCommentRequest) => {
    const result = await storageServiceClient.annotations.deleteComment({
      commentId,
      body,
    });

    if (result.isErr()) {
      console.error('Unable to delete comment');
      return false;
    }

    const response = result.value;
    annotations.commands.applyDeletedComment(response);

    return true;
  };
}

export function useCreateFreeCommentResource() {
  const createComment = useCreateComment();

  return async (
    text: string,
    placeable: IThreadPlaceable,
    mentions?: CreateCommentRequestMentions
  ) => {
    let anchor: CreateCommentRequestAnchor | undefined;
    if (placeable) {
      const [page] = placeable.pageRange;
      if (page === undefined) {
        throw new Error('Cannot create a PDF comment without a page');
      }
      anchor = {
        uuid: placeable.internalId,
        page,
        fileType: 'pdf',
        anchorType: 'free-comment',
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
      mentions,
    };

    return createComment(body);
  };
}

export function useCreateHighlightCommentResource() {
  const createComment = useCreateComment();

  return async (
    text: string,
    highlight: IHighlight,
    mentions?: CreateCommentRequestMentions
  ) => {
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
      mentions,
    };

    return createComment(body);
  };
}

export function useAttachHighlightCommentResource() {
  const createComment = useCreateComment();

  return async (
    text: string,
    uuid: string,
    mentions?: CreateCommentRequestMentions
  ) => {
    const body: CreateCommentRequest = {
      text: text,
      threadId: undefined,
      anchor: {
        fileType: 'pdf',
        anchorType: 'attachment',
        attachmentType: 'highlight',
        uuid,
      },
      mentions,
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

  return async (body: CreateCommentRequest & { threadId: number }) => {
    if (body.threadId < 0) {
      console.error('Provide a valid thread id');
      return null;
    }

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

export function usePdfCommentRealtimeBehavior() {
  const currentUserId = useUserId();
  const { annotations, documentId } = usePdfDocument();

  createConnectionWebsocketEffect((msg) => {
    if (msg.type === 'comment') {
      let incrementalUpdate: AnnotationIncrementalUpdate;
      try {
        incrementalUpdate = JSON.parse(msg.data) as AnnotationIncrementalUpdate;
        if (
          incrementalUpdate.payload.documentId !== documentId() ||
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
          annotations.commands.applyCreatedComment(
            incrementalUpdate.payload.response
          );
          break;
        case 'create-anchor':
          annotations.commands.applyCreatedAnchor(
            incrementalUpdate.payload.response
          );
          break;
        case 'edit-comment':
          annotations.commands.applyEditedComment(
            incrementalUpdate.payload.response
          );
          break;
        case 'edit-anchor':
          annotations.commands.applyEditedAnchor(
            incrementalUpdate.payload.response
          );
          break;
        case 'delete-comment':
          annotations.commands.applyDeletedComment(
            incrementalUpdate.payload.response
          );
          break;
        case 'delete-anchor':
          annotations.commands.applyDeletedAnchor(
            incrementalUpdate.payload.response
          );
          break;
        default:
          console.error('unknown comment update type', msg);
          break;
      }
    }
  });
}
