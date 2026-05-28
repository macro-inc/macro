import type { MessageData } from '@channel/Message/types';
import { senderFromStorageId } from '@queries/channel/message-sender';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { Comment } from '@service-storage/generated/schemas/comment';

export function commentToMessageData(comment: Comment): MessageData {
  return {
    id: String(comment.commentId),
    content: comment.text,
    sender_id: comment.sender ?? comment.owner,
    created_at: comment.createdAt ?? '',
    updated_at: comment.updatedAt ?? comment.createdAt ?? '',
    deleted_at: comment.deletedAt ?? null,
    edited_at:
      comment.updatedAt && comment.updatedAt !== comment.createdAt
        ? comment.updatedAt
        : null,
    attachments: [],
    reactions: [],
  };
}

export function commentToApiChannelMessage(
  comment: Comment
): ApiChannelMessage {
  return {
    id: String(comment.commentId),
    content: comment.text,
    sender: senderFromStorageId(comment.sender ?? comment.owner),
    sender_id: comment.sender ?? comment.owner,
    created_at: comment.createdAt ?? '',
    updated_at: comment.updatedAt ?? comment.createdAt ?? '',
    deleted_at: comment.deletedAt ?? null,
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
