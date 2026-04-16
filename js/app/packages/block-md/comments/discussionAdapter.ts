import type { Comment } from '@service-storage/generated/schemas/comment';
import type { MessageData } from '@channel/Message/types';

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
