import { createBlockMemo, useBlockId, useBlockName } from '@core/block';
import { messageActions, useMessageThreadsQuery } from '@queries/messages';
import type { EditMessage } from '@service-storage/generated/schemas/editMessage';
import type { PostMessage } from '@service-storage/messages';

export const documentMessagesQuery = createBlockMemo(() => {
  if (useBlockName() !== 'md') return;
  const id = useBlockId();
  return useMessageThreadsQuery(() => ({ type: 'document', id }));
});

export const documentMessageThreads = () => {
  const query = documentMessagesQuery();
  return query?.isSuccess ? (query.data ?? []) : [];
};

function actions() {
  const id = useBlockId();
  return messageActions(() => ({ type: 'document', id }));
}

export function useEditCommentResource() {
  const messages = actions();
  return async (id: string, input: EditMessage) => {
    await messages.edit(id, input);
    return true;
  };
}

export function useDeleteCommentResource() {
  const messages = actions();
  return async (id: string) => {
    await messages.delete(id);
    return true;
  };
}

export function useDeleteThreadResource() {
  return actions().deleteThread;
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
