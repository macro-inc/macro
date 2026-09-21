import type { IHighlight } from '@block-pdf/model/Highlight';
import type { IThreadPlaceable } from '@block-pdf/type/placeables';
import { useUserId } from '@core/context/user';
import { useMessageActions } from '@queries/messages/document-messages';
import { onThreadStateUpdated } from '@queries/messages/sync';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
} from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type { AnnotationIncrementalUpdate } from '@service-storage/generated/schemas/annotationIncrementalUpdate';
import type { CreateUnthreadedAnchorRequest } from '@service-storage/generated/schemas/createUnthreadedAnchorRequest';
import type { CreateUnthreadedAnchorResponse } from '@service-storage/generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteUnthreadedAnchorRequest } from '@service-storage/generated/schemas/deleteUnthreadedAnchorRequest';
import type { EditAnchorRequest } from '@service-storage/generated/schemas/editAnchorRequest';
import type { MessageEvent } from '@service-storage/generated/schemas/messageEvent';
import type { PostMessage } from '@service-storage/messages';
import { onCleanup } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';

/** A comment body without its thread placement, which the PDF resources decide. */
export type CommentInput = Omit<PostMessage, 'thread_id' | 'anchor'>;

function useDocumentMessageActions() {
  const { documentId } = usePdfDocument();
  return useMessageActions(() => ({ type: 'document', id: documentId() }));
}

async function createHighlightAnchor(
  documentId: string,
  highlight: IHighlight
): Promise<CreateUnthreadedAnchorResponse | null> {
  if (highlight.pageViewport == null) {
    console.error('Highlight page viewport is null');
    return null;
  }
  const body: CreateUnthreadedAnchorRequest = {
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
    pageViewportHeight: highlight.pageViewport.height,
    pageViewportWidth: highlight.pageViewport.width,
  };
  const result = await storageServiceClient.annotations.createAnchor({
    documentId,
    body,
  });
  if (result.isErr()) {
    console.error('Unable to create anchor');
    return null;
  }
  return result.value;
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

    annotations.commands.applyDeletedAnchor(result.value);

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

    annotations.commands.applyEditedAnchor(result.value);

    return true;
  };
}

/** Posts a root that creates its comment placeable on the server. */
export function useCreateFreeCommentResource() {
  const { annotations, documentId } = usePdfDocument();
  const messages = useDocumentMessageActions();

  return async (input: CommentInput, placeable: IThreadPlaceable) => {
    const [page] = placeable.pageRange;
    if (page === undefined) {
      throw new Error('Cannot create a PDF comment without a page');
    }
    const message = await messages.post({
      ...input,
      anchor: {
        type: 'pdf_placeable',
        anchor_id: placeable.internalId,
        page,
        x_pct: placeable.position.xPct,
        y_pct: placeable.position.yPct,
        width_pct: placeable.position.widthPct,
        height_pct: placeable.position.heightPct,
      },
    });
    // Show the placeable from the draft's geometry until the anchors reload.
    annotations.commands.applyCreatedAnchor({
      anchorType: 'placeable',
      documentId: documentId(),
      uuid: placeable.internalId,
      owner: placeable.owner,
      rootId: message.id,
      page,
      originalPage: placeable.originalPage,
      originalIndex: placeable.originalIndex,
      xPct: placeable.position.xPct,
      yPct: placeable.position.yPct,
      widthPct: placeable.position.widthPct,
      heightPct: placeable.position.heightPct,
      rotation: placeable.position.rotation,
      allowableEdits: placeable.allowableEdits,
      wasEdited: placeable.wasEdited,
      wasDeleted: placeable.wasDeleted,
      shouldLockOnSave: placeable.shouldLockOnSave,
    });
    void annotations.commands.refetchAnchors();
    return message;
  };
}

/** Posts a root on a highlight that already exists on the server. */
export function useAttachHighlightCommentResource() {
  const annotations = usePdfDocument().annotations;
  const messages = useDocumentMessageActions();

  return async (input: CommentInput, uuid: string) => {
    const message = await messages.post({
      ...input,
      anchor: { type: 'pdf_highlight', anchor_id: uuid },
    });
    annotations.commands.attachAnchorRoot(uuid, message.id);
    void annotations.commands.refetchAnchors();
    return message;
  };
}

/**
 * Saves a drafted highlight, then posts its root. The anchor joins the local
 * state together with its discussion so the draft card is replaced by the
 * thread rather than by a bare highlight.
 */
export function useCreateHighlightCommentResource() {
  const { annotations, documentId } = usePdfDocument();
  const messages = useDocumentMessageActions();

  return async (input: CommentInput, highlight: IHighlight) => {
    const anchor = await createHighlightAnchor(documentId(), highlight);
    if (!anchor) return null;
    try {
      const message = await messages.post({
        ...input,
        anchor: { type: 'pdf_highlight', anchor_id: anchor.uuid },
      });
      annotations.commands.applyCreatedAnchor({
        ...anchor,
        rootId: message.id,
      });
      void annotations.commands.refetchAnchors();
      return message;
    } catch (error) {
      // The highlight was saved; keep it visible without a discussion.
      annotations.commands.applyCreatedAnchor(anchor);
      throw error;
    }
  };
}

export function useCreateUnthreadedHighlightResource() {
  const { annotations, documentId } = usePdfDocument();

  return async (highlight: IHighlight) => {
    const anchor = await createHighlightAnchor(documentId(), highlight);
    if (!anchor) return false;
    annotations.commands.applyCreatedAnchor(anchor);
    return true;
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
  const messages = useDocumentMessageActions();

  return (input: CommentInput & { thread_id: string }) => messages.post(input);
}

/** Deletes a discussion; the server removes its placeable or detaches its highlight. */
export function useDeleteThreadResource() {
  const annotations = usePdfDocument().annotations;
  const messages = useDocumentMessageActions();

  return async (rootId: string) => {
    await messages.deleteThread(rootId);
    annotations.commands.applyThreadDeleted(rootId);
    void annotations.commands.refetchAnchors();
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

/**
 * Keeps anchors in step with other clients. Geometry changes arrive on the
 * annotation channel; discussions posted or deleted elsewhere change anchors
 * on the server, so a document `message_update` reloads them.
 */
export function usePdfCommentRealtimeBehavior() {
  const currentUserId = useUserId();
  const { annotations, documentId } = usePdfDocument();

  createConnectionWebsocketEffect((msg) => {
    if (msg.type === 'message_update') {
      const event = parseWebsocketPayload<MessageEvent>(msg.type, msg.data);
      if (
        event?.parent?.type !== 'document' ||
        event.parent.id !== documentId() ||
        event.change?.type === 'typing'
      )
        return;
      void annotations.commands.refetchAnchors();
      return;
    }
    if (msg.type !== 'comment') return;

    let incrementalUpdate: AnnotationIncrementalUpdate;
    try {
      incrementalUpdate = JSON.parse(msg.data) as AnnotationIncrementalUpdate;
    } catch (e) {
      console.warn('unable to parse annotation incremental update', e);
      return;
    }
    if (
      incrementalUpdate.payload.documentId !== documentId() ||
      incrementalUpdate.payload.sender === currentUserId()
    ) {
      return;
    }

    switch (incrementalUpdate.updateType) {
      case 'create-anchor':
        annotations.commands.applyCreatedAnchor(
          incrementalUpdate.payload.response
        );
        break;
      case 'edit-anchor':
        annotations.commands.applyEditedAnchor(
          incrementalUpdate.payload.response
        );
        break;
      case 'delete-anchor':
        annotations.commands.applyDeletedAnchor(
          incrementalUpdate.payload.response
        );
        break;
      default:
        break;
    }
  });

  onCleanup(
    onThreadStateUpdated((parent, state) => {
      if (
        parent.type === 'document' &&
        parent.id === documentId() &&
        state.deleted_at
      )
        annotations.commands.applyThreadDeleted(state.root_id);
    })
  );
}
