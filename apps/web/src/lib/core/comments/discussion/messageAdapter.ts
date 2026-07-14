import type { MessageData } from '@channel/Message/types';
import { senderFromStorageId } from '@queries/channel/message-sender';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { DiscussionComment } from './types';

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
export function discussionCommentToApiChannelMessage(
  comment: DiscussionComment
): ApiChannelMessage {
  return {
    id: comment.id,
    content: comment.text,
    sender: senderFromStorageId(comment.authorId),
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
    channel_id: '',
    thread: {
      reply_count: 0,
      latest_reply_at: null,
      preview: [],
    },
  };
}
