import { createMemo, createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { Notification } from '../types/notification';
import { getChannelThreadName } from '../utils/channel-thread-name';

function reply(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notification-1',
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: '2026-09-15T18:00:00Z',
    updated_at: '2026-09-15T18:00:00Z',
    state: 'unseen',
    sent: true,
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: {
        channelName: 'Design',
        channelType: 'public',
        threadId: 'thread-1',
        messageId: 'reply-1',
        messageContent: 'A reply',
      },
    },
    ...overrides,
  };
}

const thread = (notifications: Notification[] = [reply()]) => ({
  channelId: 'channel-1',
  threadId: 'thread-1',
  notifications: () => notifications,
});

describe('getChannelThreadName', () => {
  it('prefers the current channel name over the notification snapshot', () => {
    expect(
      getChannelThreadName(thread(), { 'channel-1': { name: 'Product' } })
    ).toBe('Product');
  });

  it.each([undefined, null, '', '   '])(
    'uses notification metadata when the cached name is %s',
    (name) => {
      expect(getChannelThreadName(thread(), { 'channel-1': { name } })).toBe(
        'Design'
      );
    }
  );

  it('skips replies from other channels and threads', () => {
    const entity = thread([
      reply({ entity_id: 'channel-2' }),
      reply({
        notification_metadata: {
          tag: 'channel_message_reply',
          content: {
            channelName: 'An old name',
            channelType: 'public',
            threadId: 'thread-2',
            messageId: 'reply-2',
            messageContent: 'Another thread',
          },
        },
      }),
    ]);
    expect(getChannelThreadName(entity, {})).toBe('Unknown channel');
    expect(
      getChannelThreadName(thread([...entity.notifications(), reply()]), {})
    ).toBe('Design');
  });

  it('skips empty notification names to find a usable snapshot', () => {
    const emptyName = reply({
      notification_metadata: {
        tag: 'channel_message_reply',
        content: {
          channelName: '   ',
          channelType: 'public',
          threadId: 'thread-1',
          messageId: 'reply-2',
          messageContent: 'Another reply',
        },
      },
    });
    expect(getChannelThreadName(thread([emptyName, reply()]), {})).toBe(
      'Design'
    );
  });

  it.each([undefined, 'thread-1'])(
    'uses mentions of the thread root or its replies (threadId: %s)',
    (threadId) => {
      const mention = reply({
        notification_metadata: {
          tag: 'channel_mention',
          content: {
            channelName: 'Design',
            channelType: 'public',
            threadId,
            messageId: threadId ? 'reply-1' : 'thread-1',
            messageContent: 'A mention',
          },
        },
      });
      expect(getChannelThreadName(thread([mention]), {})).toBe('Design');
    }
  );

  it('uses a send notification only for the thread root', () => {
    const send = (messageId: string) =>
      reply({
        notification_metadata: {
          tag: 'channel_message_send',
          content: {
            channelName: 'Design',
            channelType: 'public',
            messageId,
            messageContent: 'A message',
          },
        },
      });
    expect(getChannelThreadName(thread([send('thread-1')]), {})).toBe('Design');
    expect(getChannelThreadName(thread([send('other-message')]), {})).toBe(
      'Unknown channel'
    );
  });

  it('uses a neutral fallback when no channel name is available', () => {
    expect(getChannelThreadName(thread([]), {})).toBe('Unknown channel');
    expect(
      getChannelThreadName({ channelId: 'channel-1', threadId: 'thread-1' }, {})
    ).toBe('Unknown channel');
  });

  it('updates when notifications arrive, the cache loads, or the row changes', () => {
    createRoot((dispose) => {
      const [entity, setEntity] = createSignal(thread([]));
      const [channels, setChannels] = createSignal<
        Record<string, { name: string }>
      >({});
      const name = createMemo(() => getChannelThreadName(entity(), channels()));

      expect(name()).toBe('Unknown channel');
      setEntity(thread());
      expect(name()).toBe('Design');
      setChannels({ 'channel-1': { name: 'Renamed channel' } });
      expect(name()).toBe('Renamed channel');
      setEntity({ ...thread(), channelId: 'channel-2', threadId: 'thread-2' });
      expect(name()).toBe('Unknown channel');
      dispose();
    });
  });
});
