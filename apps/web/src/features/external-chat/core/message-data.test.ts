import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './chat';
import { chatMessageData } from './message-data';

const message: ChatMessage = {
  id: 'message-1',
  kind: 'message',
  sender: { name: 'WhatsApp participant', userId: 'macro|owner@example.test' },
  mentions: [],
  forwarded: false,
  body: 'Sent from my phone',
  sentAt: '2026-10-22T15:41:58Z',
  edited: false,
  deleted: false,
  reactions: [],
  attachments: [],
};

describe('chat message senders', () => {
  it('shows a Macro user as themselves, whatever WhatsApp called them', () => {
    const row = chatMessageData(message, undefined, (body) => body);

    expect(row.sender_id).toBe('macro|owner@example.test');
    expect(row.imported_author).toBeNull();
  });

  it('shows anyone else by their WhatsApp name', () => {
    const row = chatMessageData(
      { ...message, sender: { name: 'Ana Ruiz' } },
      undefined,
      (body) => body
    );

    expect(row.sender_id).toBe('');
    expect(row.imported_author).toEqual({ name: 'Ana Ruiz' });
  });
});
