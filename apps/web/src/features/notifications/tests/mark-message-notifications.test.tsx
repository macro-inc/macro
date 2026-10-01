import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { render, waitFor } from '@solidjs/testing-library';
import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MarkMessageNotifications,
  MessageNotificationIndexContext,
} from '../components/MarkMessageNotifications';
import { indexUnreadMessageNotifications } from '../unread-message-notifications';

const mocks = vi.hoisted(() => ({
  notificationSource: undefined as NotificationSource | undefined,
}));

vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.notificationSource,
}));

function documentMentionNotification(
  id: string,
  messageId = 'message-1'
): UnifiedNotification {
  return {
    id,
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: '2026-08-17T00:00:00.000Z',
    state: 'unseen',
    notification_event_type: 'document_mention',
    notification_metadata: {
      tag: 'document_mention',
      content: { messageId },
    } as UnifiedNotification['notification_metadata'],
    sent: true,
    updated_at: '2026-08-17T00:00:00.000Z',
    viewed_at: null,
  };
}

describe('MarkMessageNotifications', () => {
  const bulkMarkAsRead = vi.fn<NotificationSource['bulkMarkAsRead']>();
  let matchingNotifications: UnifiedNotification[];

  beforeEach(() => {
    vi.clearAllMocks();
    matchingNotifications = [
      documentMentionNotification('notification-1'),
      documentMentionNotification('notification-2'),
    ];
    bulkMarkAsRead.mockImplementation(async (notifications) => {
      for (const notification of notifications) {
        notification.state = 'seen';
        notification.viewed_at = '2026-08-17T00:01:00.000Z';
      }
    });
    mocks.notificationSource = {
      notificationsByEntity: () => ({
        'channel@channel-1': [
          ...matchingNotifications,
          documentMentionNotification('notification-3', 'other-message'),
        ],
      }),
      bulkMarkAsRead,
    } as unknown as NotificationSource;
  });

  it('marks every document mention from the mounted channel message as read', async () => {
    render(() => (
      <MarkMessageNotifications
        messageId="message-1"
        parent={{ type: 'channel', id: 'channel-1' }}
      >
        <span>Message</span>
      </MarkMessageNotifications>
    ));

    await waitFor(() => {
      expect(matchingNotifications.every((n) => n.viewed_at)).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bulkMarkAsRead).toHaveBeenCalledOnce();
    expect(bulkMarkAsRead).toHaveBeenCalledWith(matchingNotifications);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('marks scoped notifications on mount and live updates without reading the global feed', async () => {
    const observer = vi.fn();
    vi.stubGlobal('IntersectionObserver', observer);
    const globalRead = vi.spyOn(
      mocks.notificationSource!,
      'notificationsByEntity'
    );
    const [notifications, setNotifications] = createSignal(
      matchingNotifications
    );
    const view = render(() => {
      const index = createMemo(() =>
        indexUnreadMessageNotifications(notifications())
      );
      return (
        <MessageNotificationIndexContext.Provider value={index}>
          <MarkMessageNotifications
            messageId="message-1"
            parent={{ type: 'channel', id: 'channel-1' }}
          >
            <span>Message</span>
          </MarkMessageNotifications>
        </MessageNotificationIndexContext.Provider>
      );
    });
    expect(globalRead).not.toHaveBeenCalled();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());
    expect(bulkMarkAsRead).toHaveBeenCalledWith(matchingNotifications);
    for (let i = 0; i < 4; i++) {
      const liveNotifications = [documentMentionNotification(`live-${i}`)];
      setNotifications(liveNotifications);
      await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledTimes(i + 2));
      expect(bulkMarkAsRead).toHaveBeenLastCalledWith(liveNotifications);
    }
    expect(globalRead).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();
    expect(view.container.firstElementChild?.tagName).toBe('SPAN');
  });

  it('marks a newly unread store record and a new batch arriving while a mark is pending', async () => {
    const [notifications, setNotifications] = createStore([
      { ...documentMentionNotification('first'), state: 'seen' as const },
    ] as UnifiedNotification[]);
    let finishMark: (() => void) | undefined;
    bulkMarkAsRead.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishMark = resolve;
        })
    );
    render(() => {
      const index = createMemo(() =>
        indexUnreadMessageNotifications(notifications)
      );
      return (
        <MessageNotificationIndexContext.Provider value={index}>
          <MarkMessageNotifications
            messageId="message-1"
            parent={{ type: 'channel', id: 'channel-1' }}
          >
            <span>Message</span>
          </MarkMessageNotifications>
        </MessageNotificationIndexContext.Provider>
      );
    });
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    setNotifications(0, 'state', 'unseen');
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());

    setNotifications(0, 'state', 'seen');
    setNotifications(1, documentMentionNotification('second'));
    expect(bulkMarkAsRead).toHaveBeenCalledOnce();
    finishMark!();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledTimes(2));
    expect(bulkMarkAsRead.mock.calls[1][0].map((n) => n.id)).toEqual([
      'second',
    ]);
    setNotifications(1, 'state', 'seen');
    finishMark!();
  });

  it('bounds retries for the same notifications and retries a new batch after exhaustion', async () => {
    const error = new Error('mark failed');
    bulkMarkAsRead.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const [notifications, setNotifications] = createSignal(
      matchingNotifications
    );

    try {
      render(() => {
        const index = createMemo(() =>
          indexUnreadMessageNotifications(notifications())
        );
        return (
          <MessageNotificationIndexContext.Provider value={index}>
            <MarkMessageNotifications
              messageId="message-1"
              parent={{ type: 'channel', id: 'channel-1' }}
            >
              <span>Message</span>
            </MarkMessageNotifications>
          </MessageNotificationIndexContext.Provider>
        );
      });

      await waitFor(() => {
        expect(bulkMarkAsRead).toHaveBeenCalledTimes(3);
        expect(consoleError).toHaveBeenCalledTimes(3);
      });
      // A refetch or a different ordering must not restart the failed batch.
      setNotifications(
        [...matchingNotifications].reverse().map((n) => ({ ...n }))
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bulkMarkAsRead).toHaveBeenCalledTimes(3);

      const incoming = [documentMentionNotification('new-after-failure')];
      bulkMarkAsRead.mockImplementation(async (notifications) => {
        for (const notification of notifications) notification.state = 'seen';
      });
      setNotifications(incoming);
      await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledTimes(4));
      expect(bulkMarkAsRead).toHaveBeenLastCalledWith(incoming);
    } finally {
      consoleError.mockRestore();
    }
  });
});
