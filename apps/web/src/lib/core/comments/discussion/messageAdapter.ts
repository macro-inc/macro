import {
  attachmentEntityType,
  authoredMentions,
} from '@channel/Input/message-payload';
import type { InputSnapshot } from '@channel/Input/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { MessageData } from '@core/messages/types';
import type { DiscussionComment } from './types';

/** Adapts CRM/PR discussion records to shared message presentation. */
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
      comment.updatedAt !== comment.createdAt ? comment.updatedAt : null,
    attachments: [],
    reactions: [],
  };
}

export function messageMentions(mentions: ItemMention[]) {
  return authoredMentions(mentions);
}

export function messageAttachments(
  attachments: InputSnapshot['attachments'] = []
) {
  if (attachments.some((attachment) => attachment.pending))
    throw new Error('Wait for attachments to finish uploading');
  return attachments.map((attachment) => ({
    entity_type: attachment.entityType ?? attachmentEntityType(attachment.kind),
    entity_id: attachment.id,
    width: attachment.width,
    height: attachment.height,
  }));
}
