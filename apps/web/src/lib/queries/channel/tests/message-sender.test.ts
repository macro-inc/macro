import {
  MACRO_CODER_NAME,
  MACRO_CODER_PRINCIPAL_ID,
} from '@core/constant/macroCoder';
import { describe, expect, it } from 'vitest';
import {
  type ChannelMessageWithMaybeSender,
  getBotDisplayName,
  normalizeChannelMessageSender,
  senderFromStorageId,
} from '../message-sender';

function legacyMessage(
  senderId: string,
  replySenderId = 'macro|reply@example.com'
): ChannelMessageWithMaybeSender {
  return {
    id: 'message-1',
    channel_id: 'channel-1',
    sender_id: senderId,
    content: 'hello',
    created_at: '2026-05-28T10:00:00.000Z',
    updated_at: '2026-05-28T10:00:00.000Z',
    attachments: [],
    reactions: [],
    thread: {
      preview: [
        {
          id: 'reply-1',
          sender_id: replySenderId,
          content: 'reply',
          created_at: '2026-05-28T10:01:00.000Z',
          updated_at: '2026-05-28T10:01:00.000Z',
          attachments: [],
          reactions: [],
        },
      ],
      reply_count: 1,
      latest_reply_at: '2026-05-28T10:01:00.000Z',
    },
  };
}

describe('message sender normalization', () => {
  it('derives user senders for old channel message payloads', () => {
    const message = normalizeChannelMessageSender(
      legacyMessage('macro|alice@example.com')
    );

    expect(message.sender).toEqual({
      type: 'user',
      id: 'macro|alice@example.com',
    });
    expect(message.thread.preview[0].sender).toEqual({
      type: 'user',
      id: 'macro|reply@example.com',
    });
  });

  it('derives bot sender ids from storage ids', () => {
    expect(
      senderFromStorageId('bot|00000000-0000-0000-0000-000000000001')
    ).toEqual({
      type: 'bot',
      id: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('keeps enriched bot name and avatar from the API sender', () => {
    const enriched = {
      ...legacyMessage('bot|00000000-0000-0000-0000-000000000001'),
      sender: {
        type: 'bot' as const,
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Deploy Bot',
        avatar_url: 'https://example.com/bot.png',
      },
    };

    const message = normalizeChannelMessageSender(enriched);

    expect(message.sender).toEqual({
      type: 'bot',
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Deploy Bot',
      avatar_url: 'https://example.com/bot.png',
    });
  });

  it('resolves bot names from channel bot data', () => {
    expect(
      getBotDisplayName('bot|00000000-0000-0000-0000-000000000001', undefined, [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Deploy Bot',
        },
      ])
    ).toBe('Deploy Bot');
  });

  it('resolves built-in agent names without channel bot data', () => {
    expect(getBotDisplayName(MACRO_CODER_PRINCIPAL_ID)).toBe(MACRO_CODER_NAME);
  });

  it('uses a generic label rather than exposing an unknown bot UUID', () => {
    expect(getBotDisplayName('bot|00000000-0000-0000-0000-000000000002')).toBe(
      'Bot'
    );
  });
});
