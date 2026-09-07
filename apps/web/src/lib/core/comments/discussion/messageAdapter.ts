import {
  attachmentEntityType,
  authoredMentions,
} from '@channel/Input/message-payload';
import type { InputSnapshot } from '@channel/Input/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { messageToMessageData } from '@core/messages/message-data';
import type { MessageData } from '@core/messages/types';
import type { Message, MessageThread } from '@service-storage/messages';
import type { DiscussionComment, DiscussionThread } from './types';

/** Adapts CRM/PR and document discussion records to shared message presentation. */
export function discussionCommentToMessageData(
  comment: DiscussionComment
): MessageData {
  return {
    id: comment.id,
    content: comment.text,
    sender_id: comment.authorId,
    sender: comment.sender,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    deleted_at: comment.deletedAt,
    edited_at:
      comment.editedAt === undefined
        ? comment.updatedAt !== comment.createdAt
          ? comment.updatedAt
          : null
        : comment.editedAt,
    attachments: comment.attachments ?? [],
    reactions: comment.reactions ?? [],
  };
}

export function messageToDiscussionComment(
  message: Message
): DiscussionComment {
  return {
    id: message.id,
    threadId: message.thread_id ?? message.id,
    authorId: message.sender_id,
    parent: message.parent,
    sender: messageToMessageData(message).sender,
    importedAuthor: message.imported_author?.name,
    text: message.content,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
    editedAt: message.edited_at,
    deletedAt: message.deleted_at ?? null,
    attachments: message.attachments,
    reactions: message.reactions,
  };
}

export function messageToDiscussionThread(
  thread: MessageThread
): DiscussionThread {
  return {
    id: thread.state.root_id,
    parent: thread.root.parent,
    ownerId: thread.state.user_id,
    resolved: thread.state.resolved,
    comments: [thread.root, ...thread.replies].map(messageToDiscussionComment),
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

export function discussionInputAttachments(
  comment: DiscussionComment
): InputSnapshot['attachments'] {
  return (comment.attachments ?? []).map((attachment) => ({
    id: attachment.entity_id,
    name: attachment.entity_id,
    entityType: attachment.entity_type,
    kind:
      attachment.entity_type === 'static/image'
        ? 'image'
        : attachment.entity_type === 'static/video'
          ? 'video'
          : 'document',
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined,
  }));
}
