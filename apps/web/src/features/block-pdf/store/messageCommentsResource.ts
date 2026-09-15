import type { IHighlight } from '@block-pdf/model/Highlight';
import type { IThreadPlaceable } from '@block-pdf/type/placeables';
import { useBlockId } from '@core/block';
import { useMessageActions } from '@queries/messages/document-messages';
import type { PostMessage } from '@service-storage/messages';
import {
  anchorsResource,
  useCreateUnthreadedHighlightResource,
} from './commentsResource';

function actions() {
  const id = useBlockId();
  return useMessageActions(() => ({ type: 'document', id }));
}

/** Posting can create a PDF anchor server-side, so the anchor list is refreshed after each post. */
function useCreateMessage() {
  const messages = actions();
  const [, { refetch }] = anchorsResource;
  return async (input: PostMessage) => {
    const message = await messages.post(input);
    void refetch();
    return message;
  };
}

export function useCreateMessageReplyResource() {
  return useCreateMessage();
}

export function useCreateFreeMessageResource() {
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

export function useAttachHighlightMessageResource() {
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

export function useCreateHighlightMessageResource() {
  const createAnchor = useCreateUnthreadedHighlightResource();
  const attach = useAttachHighlightMessageResource();
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

export function useDeleteMessageThreadResource() {
  const messages = actions();
  const [, { refetch }] = anchorsResource;
  return async (rootId: string) => {
    await messages.deleteThread(rootId);
    void refetch();
  };
}
