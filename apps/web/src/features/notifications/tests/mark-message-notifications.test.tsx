import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { render, waitFor } from '@solidjs/testing-library';
import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageNotificationIndexContext } from '../components/MarkMessageNotifications';
import { indexUnreadMessageNotifications } from '../unread-message-notifications';
import {
  installMessageIntersectionObserver,
  ObservedMessage as MarkMessageNotifications,
} from './message-read-visibility';

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
  let intersect: ReturnType<typeof installMessageIntersectionObserver>;

  beforeEach(() => {
    vi.clearAllMocks();
    intersect = installMessageIntersectionObserver();
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

  it('keeps mounted notifications unread until their message becomes visible', async () => {
    render(() => (
      <MarkMessageNotifications
        messageId="message-1"
        parent={{ type: 'channel', id: 'channel-1' }}
      >
        <span>Message</span>
      </MarkMessageNotifications>
    ));

    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    intersect(false);
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    intersect();
    await waitFor(() => {
      expect(matchingNotifications.every((n) => n.viewed_at)).toBe(true);
    });

    expect(bulkMarkAsRead).toHaveBeenCalledOnce();
    expect(bulkMarkAsRead).toHaveBeenCalledWith(matchingNotifications);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marks scoped notifications and live updates only while visible without reading the global feed', async () => {
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
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    intersect();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());
    expect(bulkMarkAsRead).toHaveBeenCalledWith(matchingNotifications);
    intersect(false);
    setNotifications([documentMentionNotification('offscreen-live')]);
    expect(bulkMarkAsRead).toHaveBeenCalledOnce();
    intersect();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledTimes(2));
    for (let i = 0; i < 4; i++) {
      const liveNotifications = [documentMentionNotification(`live-${i}`)];
      setNotifications(liveNotifications);
      intersect();
      await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledTimes(i + 3));
      expect(bulkMarkAsRead).toHaveBeenLastCalledWith(liveNotifications);
    }
    expect(globalRead).not.toHaveBeenCalled();
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
    intersect();
    setNotifications(0, 'state', 'unseen');
    intersect();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());

    setNotifications(0, 'state', 'seen');
    setNotifications(1, documentMentionNotification('second'));
    intersect();
    expect(bulkMarkAsRead).toHaveBeenCalledOnce();
    finishMark!();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledTimes(2));
    expect(bulkMarkAsRead.mock.calls[1][0].map((n) => n.id)).toEqual([
      'second',
    ]);
    setNotifications(1, 'state', 'seen');
    finishMark!();
  });

  it('ignores queued visibility from an earlier notification batch', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
    const [notifications, setNotifications] = createSignal(
      matchingNotifications
    );
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
    clock.mockReturnValue(200);
    const deliverOldVisibility = intersect.queue();
    clock.mockReturnValue(300);
    const incoming = [documentMentionNotification('new-offscreen-batch')];
    setNotifications(incoming);
    deliverOldVisibility();
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    clock.mockReturnValue(400);
    intersect(false);
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    clock.mockReturnValue(500);
    intersect();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());
    expect(bulkMarkAsRead).toHaveBeenCalledWith(incoming);
  });

  it('waits for foreground and a fresh observation before reading a background notification', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const view = render(() => (
      <MarkMessageNotifications
        messageId="message-1"
        parent={{ type: 'channel', id: 'channel-1' }}
      >
        <span>Message</span>
      </MarkMessageNotifications>
    ));
    intersect();
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
    intersect();
    await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());
    view.unmount();
    intersect();
    expect(bulkMarkAsRead).toHaveBeenCalledOnce();
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

      intersect();
      await waitFor(() => {
        expect(bulkMarkAsRead).toHaveBeenCalledTimes(3);
        expect(consoleError).toHaveBeenCalledTimes(3);
      });
      // A refetch or a different ordering must not restart the failed batch.
      setNotifications(
        [...matchingNotifications].reverse().map((n) => ({ ...n }))
      );
      expect(bulkMarkAsRead).toHaveBeenCalledTimes(3);

      const incoming = [documentMentionNotification('new-after-failure')];
      bulkMarkAsRead.mockImplementation(async (notifications) => {
        for (const notification of notifications) notification.state = 'seen';
      });
      setNotifications(incoming);
      intersect();
      await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledTimes(4));
      expect(bulkMarkAsRead).toHaveBeenLastCalledWith(incoming);
    } finally {
      consoleError.mockRestore();
    }
  });
});
