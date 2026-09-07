import { senderFromStorageId } from '@queries/channel/message-sender';
import type { Message } from '@service-storage/messages';
import type { MessageData } from './types';

/** Canonical messages retain their actual edit timestamp and sender attribution. */
export function messageToMessageData(message: Message): MessageData {
  return {
    id: message.id,
    content: message.content,
    sender_id: message.sender_id,
    sender: {
      ...senderFromStorageId(message.sender_id),
      ...message.bot_profile,
      triggered_by: message.triggered_by,
    },
    created_at: message.created_at,
    updated_at: message.updated_at,
    edited_at: message.edited_at,
    deleted_at: message.deleted_at,
    thread_id: message.thread_id,
    attachments: message.attachments,
    reactions: message.reactions,
  };
}
