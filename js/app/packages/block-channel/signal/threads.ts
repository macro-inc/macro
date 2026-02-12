import type { Message } from '@queries/channel/types';

export type MessageWithThreadId = Message & {
  thread_id: NonNullable<Message['thread_id']>;
};
