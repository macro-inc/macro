import { describe, expect, it } from 'vitest';
import type { ChatSummary } from '../../external-chat/core/chat';
import { historyPromptText, waitingForPhone } from './history-import';

const OWNER = 'macro|owner@example.test';
const chat: ChatSummary = {
  id: 'chat-1',
  provider: 'whatsapp',
  kind: 'group',
  name: 'Design Crit',
  ownerId: OWNER,
  unreadCount: 0,
  canSend: true,
  backfill: { state: 'waiting_for_phone', imported: 0 },
};

describe('waitingForPhone', () => {
  it("keeps the viewer's own connected chats waiting for their phone", () => {
    const chats: ChatSummary[] = [
      chat,
      {
        ...chat,
        id: 'importing',
        backfill: { state: 'running', imported: 50 },
      },
      { ...chat, id: 'imported', backfill: { state: 'done', imported: 80 } },
      { ...chat, id: 'shared', ownerId: 'macro|someone@example.test' },
      {
        ...chat,
        id: 'disconnected',
        canSend: false,
        sendReason: 'disconnected',
      },
      { ...chat, id: 'no-history', backfill: undefined },
    ];
    expect(waitingForPhone(chats, OWNER).map(({ id }) => id)).toEqual([
      'chat-1',
    ]);
    expect(waitingForPhone(chats, undefined)).toEqual([]);
  });
});

describe('historyPromptText', () => {
  it('names one chat and counts several', () => {
    expect(historyPromptText([chat])).toBe(
      'Open WhatsApp on your phone and keep it open, then import the earlier messages of Design Crit.'
    );
    expect(historyPromptText([chat, { ...chat, id: 'chat-2' }])).toBe(
      'Open WhatsApp on your phone and keep it open, then import earlier messages of 2 chats.'
    );
  });
});
