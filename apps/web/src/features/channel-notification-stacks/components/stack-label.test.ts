import type { UnifiedNotification } from '@notifications/types';
import type { NotifEvent } from '@service-notification/generated/schemas';
import { describe, expect, it } from 'vitest';
import { channelStacks } from '../core/channel-stacks';
import { stackLabel } from './stack-label';

function notification(
  id: string,
  minute: number,
  sender: string,
  metadata: NotifEvent
): UnifiedNotification {
  const at = new Date(Date.UTC(2026, 10, 18, 10, minute)).toISOString();
  return {
    id,
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: at,
    updated_at: at,
    viewed_at: null,
    deleted_at: null,
    state: 'seen',
    sent: true,
    sender_id: sender,
    notification_event_type: metadata.tag,
    notification_metadata: metadata,
  };
}

describe('stackLabel', () => {
  it('names a thread mention by its mentioner, or no one while unknown', () => {
    const [thread] = channelStacks([
      notification('mention', 1, 'ana', {
        tag: 'channel_mention',
        content: {
          messageId: 'r1',
          threadId: 'root',
          messageContent: '',
          channelType: 'public',
        },
      }),
      notification('reply', 2, 'leo', {
        tag: 'channel_message_reply',
        content: {
          messageId: 'r2',
          threadId: 'root',
          messageContent: '',
          userId: 'leo',
          channelType: 'public',
        },
      }),
    ]);
    if (!thread) throw new Error('expected a thread stack');

    expect(stackLabel(thread, (id) => ({ ana: 'Ana', leo: 'Leo' })[id])).toBe(
      'Ana mentioned you in a thread'
    );
    expect(stackLabel(thread, (id) => (id === 'leo' ? 'Leo' : undefined))).toBe(
      'Someone mentioned you in a thread'
    );

    // A mention without a sender is never credited to the reply's sender.
    const anonymous = {
      ...thread,
      notifications: thread.notifications.map((notification) =>
        notification.notification_metadata.tag === 'channel_mention'
          ? { ...notification, sender_id: null }
          : notification
      ),
    };
    expect(
      stackLabel(anonymous, (id) => (id === 'leo' ? 'Leo' : undefined))
    ).toBe('Someone mentioned you in a thread');
  });
});
