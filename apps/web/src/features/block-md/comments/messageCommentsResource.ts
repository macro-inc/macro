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
    mentions?: PostMessage['mentions'],
    attachments?: PostMessage['attachments']
  ) =>
    messages.post({
      content,
      anchor: { type: 'markdown', mark_id: markId },
      mentions,
      attachments,
    });
}

export function useCreateMessageReplyResource() {
  return useDocumentMessageActions().post;
}
