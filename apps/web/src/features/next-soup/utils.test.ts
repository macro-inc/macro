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
import { getChannelEntityTarget, getRowClickFallbackLocation } from './utils';

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

const asRead = (notification: UnifiedNotification): UnifiedNotification =>
  ({
    ...notification,
    viewed_at: '2026-07-14T00:00:00.000Z',
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
      kind: 'message',
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
      kind: 'message',
      messageId: 'hit-reply',
      threadId: 'root-msg',
    });
  });

  it('falls back to own ids for an unstamped channel_message row without notifications', () => {
    expect(getChannelEntityTarget(channelMessageRow())).toEqual({
      kind: 'message',
      messageId: 'hit-msg',
      threadId: 'hit-thread',
    });
  });

  it('targets the driving unread notification for a channel row', () => {
    const entity = channelRow({
      notifications: [sendNotification('n1', 'notif-msg')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'notif-msg',
      threadId: undefined,
    });
  });

  it('opens a channel row at latest when it has no notifications', () => {
    expect(getChannelEntityTarget(channelRow())).toEqual({ kind: 'latest' });
  });

  it('opens a channel row at latest, skipping read notifications (latest send is your own)', () => {
    const entity = channelRow({
      notifications: [asRead(sendNotification('n1', 'read-msg'))],
    });
    expect(getChannelEntityTarget(entity)).toEqual({ kind: 'latest' });
  });

  it('targets the newest unread notification, skipping newer read ones', () => {
    const entity = channelRow({
      notifications: [
        asRead(sendNotification('n1', 'read-newer-msg')),
        sendNotification('n2', 'unread-older-msg'),
      ],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'unread-older-msg',
      threadId: undefined,
    });
  });

  it('opens a channel row at latest when its only notification is a thread reply', () => {
    const entity = channelRow({
      notifications: [replyNotification('n1', 'reply-msg', 'other-thread')],
    });
    expect(getChannelEntityTarget(entity)).toEqual({ kind: 'latest' });
  });

  it('targets the reply notification scoped to a channel_thread row', () => {
    const entity = channelThreadRow({
      notifications: [
        replyNotification('n1', 'reply-in-other-thread', 'other-thread'),
        replyNotification('n2', 'reply-msg', 'root-msg'),
      ],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'reply-msg',
      threadId: 'root-msg',
    });
  });

  it('targets a read reply notification on a channel_thread row (read state only gates channel rows)', () => {
    const entity = channelThreadRow({
      notifications: [asRead(replyNotification('n1', 'reply-msg', 'root-msg'))],
    });
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'reply-msg',
      threadId: 'root-msg',
    });
  });

  it('falls back to the thread root when no notification matches the thread', () => {
    const entity = channelThreadRow({
      notifications: [replyNotification('n1', 'reply-msg', 'other-thread')],
    });
    // The row carries its own ids (root === root). Collapsing that to a
    // top-level target is the decoder's job (see convertTargetMessage), so
    // here it passes through unchanged.
    expect(getChannelEntityTarget(entity)).toEqual({
      kind: 'message',
      messageId: 'root-msg',
      threadId: 'root-msg',
    });
  });

  it('returns undefined for non-channel entities', () => {
    const entity = { type: 'email', id: 'e1' } as unknown as EntityData;
    expect(getChannelEntityTarget(entity)).toBeUndefined();
  });
});

const emailHit = (messageId: string, content: string) => ({
  type: 'email' as const,
  content,
  sender: 'Sender',
  senderId: 'sender-1',
  sentAt: '2026-07-14T00:00:00.000Z',
  location: { type: 'email' as const, messageId },
});

const callHit = (transcriptId: string) => ({
  type: 'call_record' as const,
  id: transcriptId,
  content: 'hit content',
  senderId: 'speaker-1',
  sentAt: '2026-07-14T00:00:00.000Z',
  videoSeconds: 0,
  location: { type: 'call_record' as const, callId: 'call-1', transcriptId },
});

const searchEntity = (
  type: 'email' | 'call',
  contentHitData: unknown[] | null
): EntityData =>
  ({
    type,
    id: `${type}-1`,
    search: {
      nameHighlight: null,
      senderHighlightTerms: null,
      contentHitData,
      source: 'service',
    },
  }) as unknown as EntityData;

describe('getRowClickFallbackLocation', () => {
  it('returns no location for an email row, even with content hits', () => {
    const entity = searchEntity('email', [
      emailHit('old-msg', 'a long matched snippet of text'),
      emailHit('newer-msg', 'short'),
    ]);
    expect(getRowClickFallbackLocation(entity)).toBeUndefined();
  });

  it('returns no location for an email row without search data', () => {
    const entity = { type: 'email', id: 'e1' } as unknown as EntityData;
    expect(getRowClickFallbackLocation(entity)).toBeUndefined();
  });

  it('keeps the snippet-hit fallback for call rows', () => {
    const entity = searchEntity('call', [callHit('seg-1'), callHit('seg-2')]);
    expect(getRowClickFallbackLocation(entity)).toEqual({
      type: 'call_record',
      callId: 'call-1',
      transcriptId: 'seg-1',
    });
  });

  it('returns no location for a call row without content hits', () => {
    const entity = searchEntity('call', null);
    expect(getRowClickFallbackLocation(entity)).toBeUndefined();
  });

  it('returns no location for non-snippet entities', () => {
    const entity = { type: 'document', id: 'd1' } as unknown as EntityData;
    expect(getRowClickFallbackLocation(entity)).toBeUndefined();
  });
});
