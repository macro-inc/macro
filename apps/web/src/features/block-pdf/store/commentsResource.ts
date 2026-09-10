import type { IHighlight } from '@block-pdf/model/Highlight';
import type { IThreadPlaceable } from '@block-pdf/type/placeables';
import {
  createBlockMemo,
  createBlockResource,
  useBlockId,
  useBlockName,
} from '@core/block';
import { useMessageActions, useMessageRootsQuery } from '@queries/messages';
import { invalidateMessageTimeline } from '@queries/messages/timeline';
import { createConnectionBlockWebsocketEffect } from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type { AnnotationIncrementalUpdate } from '@service-storage/generated/schemas/annotationIncrementalUpdate';
import type { CreateUnthreadedAnchorRequest } from '@service-storage/generated/schemas/createUnthreadedAnchorRequest';
import type { CreateUnthreadedAnchorResponse } from '@service-storage/generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteUnthreadedAnchorRequest } from '@service-storage/generated/schemas/deleteUnthreadedAnchorRequest';
import type { DeleteUnthreadedAnchorResponse } from '@service-storage/generated/schemas/deleteUnthreadedAnchorResponse';
import type { EditAnchorRequest } from '@service-storage/generated/schemas/editAnchorRequest';
import type { EditAnchorResponse } from '@service-storage/generated/schemas/editAnchorResponse';
import type { PostMessage } from '@service-storage/messages';

export const documentMessagesQuery = createBlockMemo(() => {
  if (useBlockName() !== 'pdf') return;
  const id = useBlockId();
  return useMessageRootsQuery(() => ({ type: 'document', id }));
});
export const documentMessageRoots = () => {
  const query = documentMessagesQuery();
  return query?.isSuccess ? query.data : [];
};
const isPdfBlock = createBlockMemo(() => useBlockName() === 'pdf');
export const anchorsResource = createBlockResource(isPdfBlock, async () => {
  const result = await storageServiceClient.annotations.getAnchors({
    documentId: useBlockId(),
  });
  if (result.isErr()) throw new Error('Unable to load document anchors');
  return result.value.data;
});

function actions() {
  const id = useBlockId();
  return useMessageActions(() => ({ type: 'document', id }));
}
function useCreateMessage() {
  const messages = actions();
  const [, { refetch }] = anchorsResource;
  return async (input: PostMessage) => {
    const message = await messages.post(input);
    void refetch();
    return message;
  };
}
export function useDeleteCommentResource() {
  const messages = actions();
  return async (id: string) => {
    await messages.delete(id);
    return true;
  };
}
export function useCreateThreadReplyResource() {
  return useCreateMessage();
}

export function useCreateFreeCommentResource() {
  const create = useCreateMessage();
  return (
    content: string,
    placeable: IThreadPlaceable,
    mentions?: PostMessage['mentions'],
    attachments?: PostMessage['attachments']
  ) => {
    const [page] = placeable.pageRange;
    if (page === undefined) throw new Error('A PDF comment requires a page');
    return create({
      content,
      mentions,
      attachments,
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
  };
}
export function useAttachHighlightCommentResource() {
  const create = useCreateMessage();
  return (
    content: string,
    anchorId: string,
    mentions?: PostMessage['mentions'],
    attachments?: PostMessage['attachments']
  ) =>
    create({
      content,
      mentions,
      attachments,
      anchor: { type: 'pdf_highlight', anchor_id: anchorId },
    });
}
export function useCreateHighlightCommentResource() {
  const createAnchor = useCreateUnthreadedHighlightResource();
  const attach = useAttachHighlightCommentResource();
  const [anchors] = anchorsResource;
  return async (
    content: string,
    highlight: IHighlight,
    mentions?: PostMessage['mentions'],
    attachments?: PostMessage['attachments']
  ) => {
    if (
      !anchors()?.some((anchor) => anchor.uuid === highlight.uuid) &&
      !(await createAnchor(highlight))
    )
      return null;
    return attach(content, highlight.uuid, mentions, attachments);
  };
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
    const result = await storageServiceClient.annotations.createAnchor({
      documentId,
      body,
    });

    if (result.isErr()) {
      console.error('Unable to create anchor');
      return false;
    }

    const response = result.value;

    handleCreateUnthreadedAnchor(response);

    return true;
  };
}

function useHandleDeleteUnthreadedAnchor() {
  const [, { mutate: mutateAnchors }] = anchorsResource;
  const documentId = useBlockId();

  return async (response: DeleteUnthreadedAnchorResponse) => {
    mutateAnchors((prev) => prev.filter((a) => a.uuid !== response.uuid));
    if (response.threadId != null)
      void invalidateMessageTimeline({ type: 'document', id: documentId });
  };
}

function useDeleteUnthreadedAnchor() {
  const handleDeleteUnthreadedAnchor = useHandleDeleteUnthreadedAnchor();

  return async (body: DeleteUnthreadedAnchorRequest) => {
    const result = await storageServiceClient.annotations.deleteAnchor({
      body,
    });

    if (result.isErr()) {
      console.error('Unable to delete anchor');
      return false;
    }

    const response = result.value;

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
    const result = await storageServiceClient.annotations.editAnchor({
      body,
    });

    if (result.isErr()) {
      console.error('Unable to edit anchor');
      return false;
    }

    const response = result.value;

    handleEditAnchor(response);

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

createConnectionBlockWebsocketEffect((event) => {
  if (useBlockName() !== 'pdf') return;
  const id = useBlockId();
  let data;
  try {
    data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (
    event.type === 'message_update' &&
    data?.parent?.type === 'document' &&
    data.parent.id === id
  ) {
    const [, { refetch }] = anchorsResource;
    if (data.change?.type !== 'typing') void refetch();
  }
  if (event.type !== 'comment') return;
  const update = data as AnnotationIncrementalUpdate;
  if (update.payload.documentId !== id) return;
  switch (update.updateType) {
    case 'create-anchor':
      void useHandleCreateUnthreadedAnchor()(update.payload.response);
      break;
    case 'edit-anchor':
      void useHandleEditAnchor()(update.payload.response);
      break;
    case 'delete-anchor':
      void useHandleDeleteUnthreadedAnchor()(update.payload.response);
      break;
  }
});

export function useDeleteThreadResource() {
  const id = useBlockId();
  const actions = useMessageActions(() => ({ type: 'document', id }));
  const [, { refetch }] = anchorsResource;
  return async (rootId: string) => {
    await actions.deleteThread(rootId);
    void refetch();
  };
}
