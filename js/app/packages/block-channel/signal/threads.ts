import type { Message } from '@service-comms/generated/models/message';

export type MessageWithThreadId = Message & {
  thread_id: NonNullable<Message['thread_id']>;
};
