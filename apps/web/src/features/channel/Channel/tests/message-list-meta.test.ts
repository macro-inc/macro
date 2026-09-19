import { senderFromStorageId } from '@queries/channel/message-sender';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { ApiMessageSender } from '@service-storage/generated/schemas/apiMessageSender';
import { describe, expect, it } from 'vitest';
import { buildChannelMessageListMeta } from '../message-list-meta';

function createMessage(
  id: string,
  createdAt: string,
  senderId = 'user-1',
  sender: ApiMessageSender = senderFromStorageId(senderId)
): ApiChannelMessage {
  return {
    id,
    channel_id: 'channel-1',
    content: '',
    created_at: createdAt,
    updated_at: createdAt,
    sender,
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

    const meta = buildChannelMessageListMeta(messages, () => false, true);

    expect(meta.m1).toEqual({
      index: 0,
      isNewMessage: false,
      isFirstNewMessage: false,
      previousTopLevelCreatedAt: undefined,
      isGroupedWithPrevious: false,
      reachedStart: true,
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
      (message) => message.id === 'm2' || message.id === 'm3',
      true
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

    const meta = buildChannelMessageListMeta(messages, () => false, true);

    expect(meta.m1.isGroupedWithPrevious).toBe(false);
    expect(meta.m2.isGroupedWithPrevious).toBe(true);
    expect(meta.m3.isGroupedWithPrevious).toBe(true);
  });

  it('marks rows above a grouped thread fork with threadRailBelow', () => {
    const messages = [
      createMessage('m1', '2026-02-20T09:00:00.000Z'),
      createMessage('m2', '2026-02-20T09:01:00.000Z'),
      {
        ...createMessage('m3', '2026-02-20T09:02:00.000Z'),
        thread: {
          preview: [],
          reply_count: 2,
          latest_reply_at: '2026-02-20T09:03:00.000Z',
        },
      },
      createMessage('m4', '2026-02-20T10:30:00.000Z'),
    ];

    const meta = buildChannelMessageListMeta(messages, () => false, true);

    // m3 is grouped into the run but owns a thread: the rail passes down
    // through m1 (run header) and m2 to reach it.
    expect(meta.m3.isGroupedWithPrevious).toBe(true);
    expect(meta.m1.threadRailBelow).toBe(true);
    expect(meta.m2.threadRailBelow).toBe(true);
    expect(meta.m3.threadRailBelow).toBeFalsy();
    expect(meta.m4.threadRailBelow).toBeFalsy();
  });

  it('does not group agent messages triggered by different users, despite a shared bot sender_id', () => {
    const botId = 'bot|00000000-0000-0000-0000-000000000000';
    const agentSender = (triggeredBy: string): ApiMessageSender => ({
      type: 'bot',
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Macro',
      triggered_by: triggeredBy,
    });
    const messages = [
      // Two Macro-agent messages with the same bot sender_id but triggered by
      // different users must not merge under one "from" pill.
      createMessage(
        'm1',
        '2026-02-20T09:00:00.000Z',
        botId,
        agentSender('user-a')
      ),
      createMessage(
        'm2',
        '2026-02-20T09:01:00.000Z',
        botId,
        agentSender('user-b')
      ),
      // A third triggered by the same user as m2 groups with it.
      createMessage(
        'm3',
        '2026-02-20T09:02:00.000Z',
        botId,
        agentSender('user-b')
      ),
    ];

    const meta = buildChannelMessageListMeta(messages, () => false, true);

    expect(meta.m2.isGroupedWithPrevious).toBe(false);
    expect(meta.m3.isGroupedWithPrevious).toBe(true);
  });
});
