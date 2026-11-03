import { useMessageActions } from '@queries/messages/document-messages';
import {
  entityMessagesClient,
  type MessageCursor,
  type PostMessage,
} from '@service-storage/messages';
import { useMarkdownDocument } from '../context/markdown-document-context';

/** Check the complete persisted root list, never the optimistic comment cache. */
export async function hasPostedComment(documentId: string, markId: string) {
  let cursor: MessageCursor | null | undefined;
  do {
    const page = await entityMessagesClient.list(
      { type: 'document', id: documentId },
      { anchored: true, limit: 100, cursor: cursor ?? undefined }
    );
    if (
      page.items.some(
        (root) =>
          root.state.anchor?.type === 'markdown' &&
          root.state.anchor.mark_id === markId
      )
    )
      return true;
    cursor = page.next_cursor;
  } while (cursor);
  return false;
}

function useDocumentMessageActions() {
  const { documentId } = useMarkdownDocument();
  return useMessageActions(() => ({
    type: 'document',
    id: documentId(),
  }));
}

export function useCreateMarkedMessageResource() {
  const messages = useDocumentMessageActions();
  return (
    content: string,
    markId: string,
    markedText: string | undefined,
    mentions?: PostMessage['mentions'],
    attachments?: PostMessage['attachments']
  ) =>
    messages.post({
      content,
      // The server trims and bounds the snapshot; it is sent as the mark reads.
      anchor: { type: 'markdown', mark_id: markId, marked_text: markedText },
      mentions,
      attachments,
    });
}

export function useCreateMessageReplyResource() {
  return useDocumentMessageActions().post;
}
