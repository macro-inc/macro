import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  isDraftThreadId,
  type MessageCommentOperations,
  type ThreadId,
} from '@core/comments/commentType';
import { COMMIT_COMMENT_MARK_COMMAND } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { $getCommentMarkText } from '@macro-inc/lexical-core';
import { createCallback } from '@solid-primitives/rootless';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useDeleteNewComments } from './commentOperations';
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
  const { state } = useMarkdownDocument();
  const { comments: commentState, setCommentState } = state;
  const threads = commentState.threads;
  const marks = commentState.marks;
  const setMarks = (...args: unknown[]) =>
    (setCommentState as (...a: unknown[]) => void)('marks', ...args);
  const setActiveThread = (v: ThreadId | null) =>
    setCommentState('activeCommentThread', v);

  return createCallback(async (info) => {
    const editor = state.editor.md.editor;
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
    const anchorId = draft.anchorId;

    // Read the mark now rather than when the draft was made: what the comment
    // is about is whatever it still covers as the comment is posted.
    const publication = marks[anchorId]?.publication;
    const markedText =
      publication?.text() ||
      editor?.read(() => $getCommentMarkText(anchorId)) ||
      undefined;

    if (publication && !(await publication.publish())) return null;
    if (publication && marks[anchorId]?.publication !== publication)
      return null;

    const send = () =>
      createMarkedMessage(
        message.content,
        anchorId,
        markedText,
        message.mentions,
        message.attachments
      );
    const response = publication ? await publication.post(send) : await send();
    if (!response) return null;
    if (publication && marks[anchorId]?.publication !== publication)
      return response;

    if (marks[anchorId]) {
      setMarks(anchorId, 'existsOnServer', true);
      setMarks(anchorId, 'isDraft', false);
    }
    setActiveThread(response.id);
    editor?.dispatchCommand(COMMIT_COMMENT_MARK_COMMAND, {
      markId: anchorId,
    });
    deleteNewComments();
    return response;
  });
}
