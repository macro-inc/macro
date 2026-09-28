import type { IHighlight } from '@block-pdf/model/Highlight';
import type { IThreadPlaceable } from '@block-pdf/type/placeables';
import { useMessageActions } from '@queries/messages/document-messages';
import type { CreateUnthreadedAnchorRequest } from '@service-storage/generated/schemas/createUnthreadedAnchorRequest';
import type { CreateUnthreadedAnchorResponse } from '@service-storage/generated/schemas/createUnthreadedAnchorResponse';
import type { PostMessage } from '@service-storage/messages';
import { usePdfDocument } from '../context/pdf-document-context';
import { createPdfAnchor } from '../queries/annotations';

/** A comment body without its thread placement, which the PDF resources decide. */
export type MessageCommentInput = Omit<PostMessage, 'thread_id' | 'anchor'>;

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
  return createPdfAnchor(documentId, body);
}

/** Posts a root whose placeable anchor the server creates with it. */
export function useCreateFreeMessageComment() {
  const { annotations, documentId } = usePdfDocument();
  const messages = useDocumentMessageActions();

  return async (input: MessageCommentInput, placeable: IThreadPlaceable) => {
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
export function useAttachHighlightMessageComment() {
  const annotations = usePdfDocument().annotations;
  const messages = useDocumentMessageActions();

  return async (input: MessageCommentInput, uuid: string) => {
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
export function useCreateHighlightMessageComment() {
  const { annotations, documentId } = usePdfDocument();
  const messages = useDocumentMessageActions();

  return async (input: MessageCommentInput, highlight: IHighlight) => {
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

export function useCreateMessageThreadReply() {
  const messages = useDocumentMessageActions();

  return (input: MessageCommentInput & { thread_id: string }) =>
    messages.post(input);
}

/** Deletes a discussion; the server removes its placeable or detaches its highlight. */
export function useDeleteMessageThread() {
  const annotations = usePdfDocument().annotations;
  const messages = useDocumentMessageActions();

  return async (rootId: string) => {
    await messages.deleteThread(rootId);
    annotations.commands.applyThreadDeleted(rootId);
    void annotations.commands.refetchAnchors();
  };
}
