import type { MessageData } from '@core/messages/types';
import { senderFromStorageId } from '@queries/messages/message-sender';
import type { MessageSender } from '@service-storage/messages';
import type { DiscussionComment } from './types';

/** A discussion comment shaped like a channel root for the shared list layout. */
export type DiscussionChannelMessage = MessageData & {
  sender: MessageSender;
  thread: {
    reply_count: number;
    latest_reply_at: string | null;
    preview: MessageData[];
  };
};

/** Maps a normalized discussion comment to the channel `Message` shape. */
export function discussionCommentToMessageData(
  comment: DiscussionComment
): MessageData {
  return {
    id: comment.id,
    content: comment.text,
    sender_id: comment.authorId,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    deleted_at: comment.deletedAt,
    edited_at:
      comment.updatedAt && comment.updatedAt !== comment.createdAt
        ? comment.updatedAt
        : null,
    attachments: [],
    reactions: [],
  };
}

/** Maps a normalized discussion comment to the channel `Thread.Row` shape. */
export function discussionCommentToChannelMessage(
  comment: DiscussionComment
): DiscussionChannelMessage {
  return {
    ...discussionCommentToMessageData(comment),
    sender: senderFromStorageId(comment.authorId),
    thread: {
      reply_count: 0,
      latest_reply_at: null,
      preview: [],
    },
  };
}
