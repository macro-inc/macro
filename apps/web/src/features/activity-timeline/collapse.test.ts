import type { ChannelThreadEntity } from '@entity';
import type { UnifiedNotification } from '@notifications';
import { describe, expect, it } from 'vitest';
import { collapseTimeline } from './collapse';
import type { TimelineItem } from './timeline-types';

function messageNotification(args: {
  id: string;
  ts: number;
  senderId: string;
  channelId: string;
  tag?: string;
}): TimelineItem {
  return {
    kind: 'notification',
    id: args.id,
    ts: args.ts,
    notification: {
      id: args.id,
      sender_id: args.senderId,
      entity_id: args.channelId,
      notification_metadata: { tag: args.tag ?? 'channel_message_send' },
    } as unknown as UnifiedNotification,
  };
}

function sentMessage(args: {
  id: string;
  ts: number;
  channelId: string;
}): TimelineItem {
  return {
    kind: 'entity-event',
    id: args.id,
    ts: args.ts,
    verb: 'sent-message',
    entity: {
      type: 'channel_thread',
      channelId: args.channelId,
    } as unknown as ChannelThreadEntity,
  };
}

function email(id: string, ts: number): TimelineItem {
  return {
    kind: 'entity-event',
    id,
    ts,
    verb: 'sent-email',
    entity: { type: 'email' } as never,
  };
}

describe('collapseTimeline', () => {
  it('folds consecutive messages by the same sender in the same channel', () => {
    const rows = collapseTimeline([
      messageNotification({ id: 'a', ts: 30, senderId: 'u1', channelId: 'c1' }),
      messageNotification({ id: 'b', ts: 20, senderId: 'u1', channelId: 'c1' }),
      messageNotification({ id: 'c', ts: 10, senderId: 'u1', channelId: 'c1' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0]!.ts).toBe(30);
  });

  it('does not fold across different senders or channels', () => {
    const rows = collapseTimeline([
      messageNotification({ id: 'a', ts: 40, senderId: 'u1', channelId: 'c1' }),
      messageNotification({ id: 'b', ts: 30, senderId: 'u2', channelId: 'c1' }),
      messageNotification({ id: 'c', ts: 20, senderId: 'u2', channelId: 'c2' }),
    ]);
    expect(rows).toHaveLength(3);
  });

  it('breaks a run when a different event interleaves', () => {
    const rows = collapseTimeline([
      messageNotification({ id: 'a', ts: 40, senderId: 'u1', channelId: 'c1' }),
      email('e', 30),
      messageNotification({ id: 'b', ts: 20, senderId: 'u1', channelId: 'c1' }),
    ]);
    expect(rows).toHaveLength(3);
  });

  it('folds my own consecutive sent messages per channel', () => {
    const rows = collapseTimeline([
      sentMessage({ id: 'a', ts: 30, channelId: 'c1' }),
      sentMessage({ id: 'b', ts: 20, channelId: 'c1' }),
      sentMessage({ id: 'c', ts: 10, channelId: 'c2' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.items).toHaveLength(2);
  });

  it('never folds non-collapsible events, even consecutive identical verbs', () => {
    const rows = collapseTimeline([email('a', 30), email('b', 20)]);
    expect(rows).toHaveLength(2);
  });
});
