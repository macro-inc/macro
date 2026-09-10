import { createBlockMemo, useBlockId, useBlockName } from '@core/block';
import { useMessageActions, useMessageRootsQuery } from '@queries/messages';
import type { PostMessage } from '@service-storage/messages';

export const documentMessagesQuery = createBlockMemo(() => {
  if (useBlockName() !== 'md') return;
  const id = useBlockId();
  return useMessageRootsQuery(() => ({ type: 'document', id }));
});

function actions() {
  const id = useBlockId();
  return useMessageActions(() => ({ type: 'document', id }));
}

export function useCreateHighlightCommentResource() {
  const messages = actions();
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

export function useCreateThreadReplyResource() {
  return actions().post;
}
