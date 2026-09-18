import { createBlockMemo, useBlockId, useBlockName } from '@core/block';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import {
  useMessageActions,
  useMessageRootsQuery,
} from '@queries/messages/document-messages';
import type { PostMessage } from '@service-storage/messages';

/** Every root of the document, including tombstones, so marks can be reconciled. */
export const documentMessagesQuery = createBlockMemo(() => {
  if (
    useBlockName() !== 'md' ||
    !isFeatureEnabled(enableUnifiedDocumentDiscussions)
  )
    return;
  const id = useBlockId();
  return useMessageRootsQuery(() => ({ type: 'document', id }));
});

function actions() {
  const id = useBlockId();
  return useMessageActions(() => ({ type: 'document', id }));
}

export function useCreateMarkedMessageResource() {
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

export function useCreateMessageReplyResource() {
  return actions().post;
}
