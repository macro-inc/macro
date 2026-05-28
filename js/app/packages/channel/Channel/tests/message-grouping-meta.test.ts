import { senderFromStorageId } from '@queries/channel/message-sender';
import type { ApiChannelMessage } from '@service-comms/client';
import { describe, expect, it } from 'vitest';
import {
  MESSAGE_GROUPING_WINDOW_MS,
  shouldGroupWithPreviousMessage,
} from '../message-grouping-meta';

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

describe('message grouping meta', () => {
  it('groups same-author messages within the five-minute window', () => {
    const previous = createMessage('m1', '2026-02-20T09:00:00.000Z');
    const current = createMessage('m2', '2026-02-20T09:05:00.000Z');

    expect(shouldGroupWithPreviousMessage(current, previous)).toBe(true);
  });

  it('does not group when author changes', () => {
    const previous = createMessage('m1', '2026-02-20T09:00:00.000Z');
    const current = createMessage('m2', '2026-02-20T09:01:00.000Z', 'user-2');

    expect(shouldGroupWithPreviousMessage(current, previous)).toBe(false);
  });

  it('does not group when the time gap exceeds five minutes', () => {
    const previous = createMessage('m1', '2026-02-20T09:00:00.000Z');
    const current = createMessage(
      'm2',
      new Date(
        new Date(previous.created_at).getTime() + MESSAGE_GROUPING_WINDOW_MS + 1
      ).toISOString()
    );

    expect(shouldGroupWithPreviousMessage(current, previous)).toBe(false);
  });

  it('does not group when the previous message has thread replies', () => {
    const previous = {
      ...createMessage('m1', '2026-02-20T09:00:00.000Z'),
      thread: {
        preview: [],
        reply_count: 1,
        latest_reply_at: '2026-02-20T09:00:30.000Z',
      },
    };
    const current = createMessage('m2', '2026-02-20T09:01:00.000Z');

    expect(shouldGroupWithPreviousMessage(current, previous)).toBe(false);
  });
});
