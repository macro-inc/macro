import type { Message } from '@queries/channel/types';

export type TypingIndicatorMessage = Partial<Message> & {
  typingUsers: string[];
  created_at: Date;
};
