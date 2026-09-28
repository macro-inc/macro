import { useMessageActions } from '@queries/messages/document-messages';
import type { PostMessage } from '@service-storage/messages';
import { useMarkdownDocument } from '../context/markdown-document-context';

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
