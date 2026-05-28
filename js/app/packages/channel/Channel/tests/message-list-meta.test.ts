import { senderFromStorageId } from '@queries/channel/message-sender';
import type { ApiChannelMessage } from '@service-comms/client';
import { describe, expect, it } from 'vitest';
import { buildChannelMessageListMeta } from '../message-list-meta';

function createMessage(
  id: string,
  createdAt: string,
  senderId = 'user-1'
): ApiChannelMessage {
  return {
    id,
    channel_id: 'channel-1',
    content: '',
    created_at: createdAt,
    updated_at: createdAt,
    sender: senderFromStorageId(senderId),
    sender_id: senderId,
    attachments: [],
    reactions: [],
    thread: {
      preview: [],
      reply_count: 0,
      latest_reply_at: null,
    },
  };
}

describe('buildChannelMessageListMeta', () => {
  it('sets list index and previous top-level timestamp in order', () => {
    const messages = [
      createMessage('m1', '2026-02-20T09:00:00.000Z'),
      createMessage('m2', '2026-02-20T10:00:00.000Z'),
      createMessage('m3', '2026-02-21T09:00:00.000Z'),
    ];

    const meta = buildChannelMessageListMeta(messages, () => false);

    expect(meta.m1).toEqual({
      index: 0,
      isNewMessage: false,
      isFirstNewMessage: false,
      previousTopLevelCreatedAt: undefined,
      isGroupedWithPrevious: false,
    });
    expect(meta.m2.previousTopLevelCreatedAt).toBe('2026-02-20T09:00:00.000Z');
    expect(meta.m3.previousTopLevelCreatedAt).toBe('2026-02-20T10:00:00.000Z');
  });

  it('marks only the first new message as first new', () => {
    const messages = [
      createMessage('m1', '2026-02-20T09:00:00.000Z'),
      createMessage('m2', '2026-02-20T10:00:00.000Z'),
      createMessage('m3', '2026-02-21T09:00:00.000Z'),
    ];

    const meta = buildChannelMessageListMeta(
      messages,
      (message) => message.id === 'm2' || message.id === 'm3'
    );

    expect(meta.m1.isFirstNewMessage).toBe(false);
    expect(meta.m2.isNewMessage).toBe(true);
    expect(meta.m2.isFirstNewMessage).toBe(true);
    expect(meta.m3.isNewMessage).toBe(true);
    expect(meta.m3.isFirstNewMessage).toBe(false);
  });

  it('derives grouped state from the immediately previous top-level message', () => {
    const messages = [
      createMessage('m1', '2026-02-20T09:00:00.000Z'),
      createMessage('m2', '2026-02-20T09:05:00.000Z'),
      createMessage('m3', '2026-02-20T09:05:01.000Z'),
    ];

    const meta = buildChannelMessageListMeta(messages, () => false);

    expect(meta.m1.isGroupedWithPrevious).toBe(false);
    expect(meta.m2.isGroupedWithPrevious).toBe(true);
    expect(meta.m3.isGroupedWithPrevious).toBe(true);
  });
});
