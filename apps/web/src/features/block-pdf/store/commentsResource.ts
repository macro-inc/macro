import type { IHighlight } from '@block-pdf/model/Highlight';
import { useUserId } from '@core/context/user';
import { onThreadStateUpdated } from '@queries/messages/sync';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
} from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type { AnnotationIncrementalUpdate } from '@service-storage/generated/schemas/annotationIncrementalUpdate';
import type { CreateUnthreadedAnchorRequest } from '@service-storage/generated/schemas/createUnthreadedAnchorRequest';
import type { DeleteUnthreadedAnchorRequest } from '@service-storage/generated/schemas/deleteUnthreadedAnchorRequest';
import type { EditAnchorRequest } from '@service-storage/generated/schemas/editAnchorRequest';
import type { MessageEvent } from '@service-storage/generated/schemas/messageEvent';
import { onCleanup } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';

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
 * A message-path discussion creates, binds, or removes its anchor on the
 * server: a new root or a thread state change. Both paths reload anchors on
 * one, so neither acts on a stale binding.
 */
export function changesAnchors(
  event: MessageEvent | undefined,
  documentId: string
) {
  if (event?.parent?.type !== 'document' || event.parent.id !== documentId)
    return false;
  const change = event.change;
  if (change.type === 'thread_updated') return true;
  return change.type === 'posted' && !change.message.thread_id;
}

export function usePdfCommentRealtimeBehavior() {
  const currentUserId = useUserId();
  const { annotations, documentId } = usePdfDocument();

  createConnectionWebsocketEffect((msg) => {
    if (msg.type === 'message_update') {
      const event = parseWebsocketPayload<MessageEvent>(msg.type, msg.data);
      if (changesAnchors(event, documentId()))
        void annotations.commands.refetchAnchors();
      return;
    }
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
          console.error('unknown comment update type', msg);
          break;
      }
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
