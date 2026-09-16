import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { mdStore } from '@block-md/signal/markdownBlockData';
import {
  isDraftThreadId,
  type MessageCommentOperations,
} from '@core/comments/commentType';
import { COMMIT_COMMENT_MARK_COMMAND } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { createCallback } from '@solid-primitives/rootless';
import { useDeleteNewComments } from './commentOperations';
import {
  activeCommentThreadSignal,
  markStore,
  threadStore,
} from './commentStore';
import {
  useCreateMarkedMessageResource,
  useCreateMessageReplyResource,
} from './messageCommentsResource';

/** A draft posts a root anchored to its mark; anything else replies to that root. */
export function useCreateMessageComment(): MessageCommentOperations['createComment'] {
  const analytics = useAnalytics();
  const deleteNewComments = useDeleteNewComments();
  const createMarkedMessage = useCreateMarkedMessageResource();
  const createReply = useCreateMessageReplyResource();
  const threads = threadStore.get;
  const [marks, setMarks] = markStore;
  const setActiveThread = activeCommentThreadSignal.set;

  return createCallback(async (info) => {
    const editor = mdStore.get.editor;
    analytics.track('comment_create', { blockType: 'md' });
    const { threadId, ...message } = info;

    if (!isDraftThreadId(threadId)) {
      return createReply({ ...message, thread_id: String(threadId) });
    }

    setActiveThread(threadId);
    const draft = threads[threadId];
    if (!draft) {
      console.error('Unable to comment');
      return null;
    }

    const response = await createMarkedMessage(
      message.content,
      draft.anchorId,
      message.mentions,
      message.attachments
    );
    if (!response) return null;

    if (marks[draft.anchorId]) {
      setMarks(draft.anchorId, 'existsOnServer', true);
      setMarks(draft.anchorId, 'isDraft', false);
    }
    setActiveThread(response.id);
    editor?.dispatchCommand(COMMIT_COMMENT_MARK_COMMAND, {
      markId: draft.anchorId,
    });
    deleteNewComments();
    return response;
  });
}
