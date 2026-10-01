import { createMemo, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';
import type { UnifiedNotification } from '../types';
import { indexUnreadMessageNotifications } from '../unread-message-notifications';

function notification(
  id: string,
  content: Record<string, unknown>,
  state: UnifiedNotification['state'] = 'unseen'
): UnifiedNotification {
  return {
    id,
    entity_id: 'channel',
    entity_type: 'channel',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    state,
    sent: true,
    viewed_at: null,
    notification_event_type: 'document_mention',
    notification_metadata: {
      tag: 'document_mention',
      content: {
        channelType: 'private',
        documentName: 'Document',
        owner: 'user',
        messageContent: 'Message',
        ...content,
      },
    } as UnifiedNotification['notification_metadata'],
  };
}

describe('indexUnreadMessageNotifications', () => {
  it('groups every notification for the exact message, not its thread root', () => {
    const first = notification('mention-1', { messageId: 'root' });
    const second = notification('mention-2', { messageId: 'root' });
    const reply = notification('reply', {
      messageId: 'reply-message',
      threadId: 'root',
    });
    const index = indexUnreadMessageNotifications([
      first,
      second,
      reply,
      notification('thread-only', { threadId: 'root' }),
      notification('unrelated', {}),
    ]);

    expect([...index.keys()]).toEqual(['root', 'reply-message']);
    expect(index.get('root')).toEqual([first, second]);
    expect(index.get('reply-message')).toEqual([reply]);
  });

  it('stringifies comment IDs and preserves both matching fields without duplicates', () => {
    const comment = notification('comment', { commentId: 42 });
    const both = notification('both', { messageId: 'message', commentId: 43 });
    const same = notification('same', { messageId: '44', commentId: 44 });
    const index = indexUnreadMessageNotifications([comment, both, same]);

    expect(index.get('42')).toEqual([comment]);
    expect(index.get('message')).toEqual([both]);
    expect(index.get('43')).toEqual([both]);
    expect(index.get('44')).toEqual([same]);
  });

  it('does not read metadata for seen or done notifications', () => {
    const records = (['seen', 'done'] as const).map((state) => {
      const record = notification(state, { messageId: 'message' }, state);
      const content = record.notification_metadata;
      const metadata = vi.fn(() => content);
      Object.defineProperty(record, 'notification_metadata', { get: metadata });
      return { record, metadata };
    });

    expect(
      indexUnreadMessageNotifications(records.map(({ record }) => record)).size
    ).toBe(0);
    for (const { metadata } of records) expect(metadata).not.toHaveBeenCalled();
  });

  it('reacts to in-place state changes, new records, and notification removal', () => {
    createRoot((dispose) => {
      try {
        const [records, setRecords] = createStore([
          notification('one', { messageId: 'message' }, 'seen'),
        ]);
        const index = createMemo(() =>
          indexUnreadMessageNotifications(records)
        );
        expect(index().size).toBe(0);

        setRecords(0, 'state', 'unseen');
        expect(
          index()
            .get('message')
            ?.map((n) => n.id)
        ).toEqual(['one']);
        setRecords(0, 'state', 'done');
        expect(index().size).toBe(0);

        setRecords([notification('two', { messageId: 'reply' })]);
        expect(
          index()
            .get('reply')
            ?.map((n) => n.id)
        ).toEqual(['two']);
        setRecords([]);
        expect(index().size).toBe(0);
      } finally {
        dispose();
      }
    });
  });

  it('tracks local state overrides and recovers when an override is rolled back', () => {
    createRoot((dispose) => {
      try {
        const [seen, setSeen] = createSignal(false);
        const record = notification('local', { messageId: 'message' });
        const overridden: UnifiedNotification = {
          ...record,
          get state() {
            return seen() ? 'seen' : record.state;
          },
        };
        const index = createMemo(() =>
          indexUnreadMessageNotifications([overridden])
        );
        expect(index().get('message')).toEqual([overridden]);
        setSeen(true);
        expect(index().size).toBe(0);
        setSeen(false);
        expect(index().get('message')).toEqual([overridden]);
      } finally {
        dispose();
      }
    });
  });
});
