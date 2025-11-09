import type { Message } from '@service-comms/generated/models/message';

export type TypingIndicatorMessage = Partial<Message> & {
  typingUsers: string[];
  created_at: string;
};
