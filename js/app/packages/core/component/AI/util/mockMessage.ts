import { uuid } from 'short-uuid';
import { type ChatMessageWithAttachments, Model } from '../types';

// TODO mock attachments
function user(text: string, _attachments: [] = []): ChatMessageWithAttachments {
  return {
    attachments: _attachments,
    content: text,
    id: uuid(),
    role: 'user',
    model: Model['anthropic/claude-sonnet-4'],
  };
}

function assistant(text: string): ChatMessageWithAttachments {
  return {
    attachments: [],
    content: [{ type: 'text', text }],
    id: uuid(),
    role: 'assistant',
  };
}

type Message =
  | { type: 'assistant'; text: string }
  | { type: 'user'; text: string };

export function mockMessages(
  messages: Message[]
): ChatMessageWithAttachments[] {
  return messages.map((msg) => {
    if (msg.type === 'user') {
      return user(msg.text);
    } else {
      return assistant(msg.text);
    }
  });
}
