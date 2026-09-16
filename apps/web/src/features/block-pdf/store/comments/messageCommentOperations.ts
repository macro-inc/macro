import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { commentsStore } from '@block-pdf/store/comments/commentStore';
import {
  isDraftThreadId,
  type MessageCommentOperations,
} from '@core/comments/commentType';
import type { Message } from '@service-storage/messages';
import { createCallback } from '@solid-primitives/rootless';
import { highlightsUuidMap } from '../highlight';
import {
  useAttachHighlightMessageResource,
  useCreateFreeMessageResource,
  useCreateHighlightMessageResource,
  useCreateMessageReplyResource,
} from '../messageCommentsResource';
import { useDeleteNewComments } from './commentOperations';
import { newThreadPlaceable } from './freeComments';

/** A draft posts a root anchored to its highlight or placeable; anything else replies. */
export function useCreateMessageComment(): MessageCommentOperations['createComment'] {
  const analytics = useAnalytics();
  const deleteNewComments = useDeleteNewComments();
  const createFreeComment = useCreateFreeMessageResource();
  const createHighlightComment = useCreateHighlightMessageResource();
  const attachHighlightComment = useAttachHighlightMessageResource();
  const createReply = useCreateMessageReplyResource();

  return createCallback(async (info) => {
    analytics.track('comment_create', { blockType: 'pdf' });
    const { threadId, ...message } = info;

    if (!isDraftThreadId(threadId)) {
      return createReply({ ...message, thread_id: String(threadId) });
    }

    const draft = commentsStore.get.find((c) => c.threadId === threadId);
    if (!draft) {
      console.error('Unable to comment');
      return null;
    }

    let response: Message | null = null;
    switch (draft.type) {
      case 'highlight': {
        const highlight = highlightsUuidMap()?.[draft.anchorId];
        if (!highlight) {
          console.error('Unable to find highlight');
          return null;
        }
        response = highlight.existsOnServer
          ? await attachHighlightComment(
              message.content,
              highlight.uuid,
              message.mentions,
              message.attachments
            )
          : await createHighlightComment(
              message.content,
              highlight,
              message.mentions,
              message.attachments
            );
        break;
      }
      case 'free': {
        const placeable = newThreadPlaceable();
        if (!placeable || placeable.internalId !== draft.anchorId) {
          console.error('Unable to find new thread placeable');
          return null;
        }
        response = await createFreeComment(
          message.content,
          placeable,
          message.mentions,
          message.attachments
        );
        break;
      }
      default:
        console.error('invalid comment type', draft.type);
        return null;
    }

    if (response) deleteNewComments();
    return response;
  });
}
