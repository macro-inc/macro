import type {
  Attachment,
  GetChannelResponse,
  GetChannelResponseReactions,
  Message,
} from '@service-comms/generated/models';

export type MessageWithThreadId = Message & {
  thread_id: NonNullable<Message['thread_id']>;
};

/**
 * Get top-level messages (messages that are not replies in a thread)
 */
export function getTopLevelMessages(data: GetChannelResponse): Message[] {
  return data.messages.filter((m) => !m.thread_id);
}

/**
 * Get thread messages grouped by parent message ID
 */
export function getThreadMessages(
  data: GetChannelResponse
): Record<string, MessageWithThreadId[]> {
  const threads: Record<string, MessageWithThreadId[]> = {};

  for (const message of data.messages) {
    if (message.thread_id) {
      const threadId = message.thread_id;
      if (!threads[threadId]) {
        threads[threadId] = [];
      }
      threads[threadId].push(message as MessageWithThreadId);
    }
  }

  return threads;
}

/**
 * Check if the current user is an admin or owner of the channel
 */
export function isChannelAdminOrOwner(data: GetChannelResponse): boolean {
  const access = data.access;
  if (!access || access === 'NoAccess') return false;
  return ['admin', 'owner'].includes(access.Access.role);
}

export function getReactionsForMessage(
  reactions: GetChannelResponseReactions,
  messageId: string
) {
  return reactions[messageId] ?? [];
}

export function getAttachmentsByMessageId(
  attachments: Attachment[]
): Record<string, Attachment[]> {
  return attachments.reduce(
    (acc, attachment) => {
      const id = attachment.message_id;
      if (!acc[id]) {
        acc[id] = [];
      }
      acc[id].push(attachment);
      return acc;
    },
    {} as Record<string, Attachment[]>
  );
}

