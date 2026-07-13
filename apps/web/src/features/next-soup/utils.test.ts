import { describe, expect, it, vi } from 'vitest';

// utils.ts transitively imports the websocket client modules, which open real
// sockets at module scope and reject under jsdom.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

import type { ChannelEntityTarget, EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications';
import { getChannelEntityTarget } from './utils';

const sendNotification = (id: string, messageId: string): UnifiedNotification =>
  ({
    id,
    entity_type: 'channel',
    entity_id: 'channel-1',
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: { messageId },
    },
  }) as unknown as UnifiedNotification;

const replyNotification = (
  id: string,
  messageId: string,
  threadId: string
): UnifiedNotification =>
  ({
    id,
    entity_type: 'channel',
    entity_id: 'channel-1',
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: { messageId, threadId },
    },
  }) as unknown as UnifiedNotification;

const channelMessageRow = (opts?: {
  target?: ChannelEntityTarget;
  notifications?: UnifiedNotification[];
}): EntityData =>
  ({
    type: 'channel_message',
    id: 'channel-1:hit-msg',
    channelId: 'channel-1',
    messageId: 'hit-msg',
    threadId: 'hit-thread',
    ...(opts?.target ? { target: opts.target } : {}),
    ...(opts?.notifications ? { notifications: () => opts.notifications } : {}),
  }) as unknown as EntityData;

const channelRow = (opts?: {
  target?: ChannelEntityTarget;
  notifications?: UnifiedNotification[];
}): EntityData =>
  ({
    type: 'channel',
    id: 'channel-1',
    ...(opts?.target ? { target: opts.target } : {}),
    ...(opts?.notifications ? { notifications: () => opts.notifications } : {}),
  }) as unknown as EntityData;

const channelThreadRow = (opts?: {
  target?: ChannelEntityTarget;
  notifications?: UnifiedNotification[];
}): EntityData =>
  ({
    type: 'channel_thread',
    id: 'root-msg',
    channelId: 'channel-1',
    messageId: 'root-msg',
    threadId: 'root-msg',
    ...(opts?.target ? { target: opts.target } : {}),
    ...(opts?.notifications ? { notifications: () => opts.notifications } : {}),
  }) as unknown as EntityData;

describe('getChannelEntityTarget', () => {
  it('activates a stamped target over attached channel notifications (search message hit)', () => {
    const entity = channelMessageRow({
      target: { messageId: 'hit-msg', threadId: 'hit-thread' },
      notifications: [sendNotification('n1', 'recent-unread-msg')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      messageId: 'hit-msg',
      threadId: 'hit-thread',
    });
  });

  it('activates a stamped target on a channel_thread row over notifications (future thread hit)', () => {
    const entity = channelThreadRow({
      target: { messageId: 'hit-reply', threadId: 'root-msg' },
      notifications: [replyNotification('n1', 'newest-reply', 'root-msg')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      messageId: 'hit-reply',
      threadId: 'root-msg',
    });
  });

  it('falls back to own ids for an unstamped channel_message row without notifications', () => {
    expect(getChannelEntityTarget(channelMessageRow())).toEqual({
      messageId: 'hit-msg',
      threadId: 'hit-thread',
    });
  });

  it('targets the driving notification for a channel row', () => {
    const entity = channelRow({
      notifications: [sendNotification('n1', 'notif-msg')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      messageId: 'notif-msg',
      threadId: undefined,
    });
  });

  it('returns no target for a channel row without notifications', () => {
    expect(getChannelEntityTarget(channelRow())).toBeUndefined();
  });

  it('skips thread-reply notifications for a channel row', () => {
    const entity = channelRow({
      notifications: [replyNotification('n1', 'reply-msg', 'other-thread')],
    });
    expect(getChannelEntityTarget(entity)).toBeUndefined();
  });

  it('targets the reply notification scoped to a channel_thread row', () => {
    const entity = channelThreadRow({
      notifications: [
        replyNotification('n1', 'reply-in-other-thread', 'other-thread'),
        replyNotification('n2', 'reply-msg', 'root-msg'),
      ],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      messageId: 'reply-msg',
      threadId: 'root-msg',
    });
  });

  it('falls back to the thread root when no notification matches the thread', () => {
    const entity = channelThreadRow({
      notifications: [replyNotification('n1', 'reply-msg', 'other-thread')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      messageId: 'root-msg',
      threadId: 'root-msg',
    });
  });

  it('returns undefined for non-channel entities', () => {
    const entity = { type: 'email', id: 'e1' } as unknown as EntityData;
    expect(getChannelEntityTarget(entity)).toBeUndefined();
  });
});
