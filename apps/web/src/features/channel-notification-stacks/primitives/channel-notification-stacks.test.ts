import type { UnifiedNotification } from '@notifications/types';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createChannelNotificationStacks } from './channel-notification-stacks';

function reply(
  id: string,
  state: UnifiedNotification['state']
): UnifiedNotification {
  const at = new Date(Date.UTC(2026, 10, 18, 10, 0)).toISOString();
  return {
    id,
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: at,
    updated_at: at,
    viewed_at: null,
    deleted_at: null,
    state,
    sent: true,
    sender_id: 'leo',
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: {
        messageId: `m-${id}`,
        threadId: 'root',
        messageContent: '',
        userId: 'leo',
        channelType: 'public',
      },
    },
  };
}

function setup(markDone: () => Promise<boolean>) {
  return createRoot((dispose) => {
    const [notDone, setNotDone] = createSignal<UnifiedNotification[]>([
      reply('older', 'seen'),
      reply('a', 'unseen'),
    ]);
    const marked: string[][] = [];
    const stacks = createChannelNotificationStacks({
      notDone,
      settled: () => true,
      complete: () => true,
      readAt: (n) => n.viewed_at ?? undefined,
      unreadSince: Date.now() - 1_000,
      markDone: (_stacks, notifications) => {
        marked.push(notifications.map((n) => n.id));
        return markDone();
      },
    });
    return { stacks, setNotDone, marked, dispose };
  });
}

describe('createChannelNotificationStacks', () => {
  it('keeps a read entry listed without its unread state', () => {
    const { stacks, setNotDone, dispose } = setup(async () => true);
    expect(stacks.listed()[0]?.notifications[0]?.state).toBe('unseen');

    setNotDone([
      reply('older', 'seen'),
      { ...reply('a', 'seen'), viewed_at: new Date().toISOString() },
    ]);
    expect(stacks.listed()).toHaveLength(1);
    expect(stacks.listed()[0]?.notifications[0]?.state).toBe('seen');
    dispose();
  });

  it('drops an entry done elsewhere', () => {
    const { stacks, setNotDone, dispose } = setup(async () => true);
    setNotDone([reply('older', 'seen')]);
    expect(stacks.listed()).toHaveLength(0);
    dispose();
  });

  it('takes a marked entry off with its whole stack, and puts it back on failure', async () => {
    let finish!: (ok: boolean) => void;
    const { stacks, marked, dispose } = setup(
      () => new Promise((resolve) => (finish = resolve))
    );

    const marking = stacks.markDone(stacks.listed());
    expect(stacks.listed()).toHaveLength(0);
    expect(marked).toEqual([['a', 'older']]);

    finish(false);
    await marking;
    expect(stacks.listed()).toHaveLength(1);
    dispose();
  });
});
