import { MarkMessageNotifications } from '@notifications/components/MarkMessageNotifications';
import type { UnifiedNotification } from '@notifications/types';
import type { MessageListItem } from '@service-storage/messages';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal, For, Show } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { ChannelUnreadNotifications } from '../ChannelUnreadNotifications';
import { UnreadNotificationsOverlay } from '../UnreadNotificationsOverlay';

const mocks = vi.hoisted(() => ({ query: vi.fn(), source: vi.fn() }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: mocks.source,
}));
vi.mock('@queries/channel/notifications', () => ({
  createChannelNotificationsQuery: mocks.query,
}));
vi.mock('@queries/messages/timeline', () => ({
  useMessageTimelineByIdsQuery: () => ({
    isPending: true,
    get data() {
      throw new Error('Read pending parent query');
    },
  }),
}));

function notification(threadId: string, time: number): UnifiedNotification {
  return {
    id: `n-${time}`,
    entity_id: 'channel',
    entity_type: 'channel',
    state: 'unseen',
    sent: true,
    viewed_at: null,
    created_at: `2026-09-01T${time}:00:00Z`,
    updated_at: '2026-09-01T00:00:00Z',
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: {
        channelType: 'private',
        messageId: `reply-${time}`,
        threadId,
        messageContent: 'Hello',
      },
    },
  };
}

it('shares unread lookups across mounted messages without rescanning history per row', async () => {
  const reply = notification('root-1', 12);
  const metadata = reply.notification_metadata;
  const readMetadata = vi.fn(() => metadata);
  Object.defineProperty(reply, 'notification_metadata', { get: readMetadata });
  const history = Array.from({ length: 200 }, (_, index) => ({
    ...notification('root-1', 12),
    id: `done-${index}`,
    state: 'done' as const,
    get notification_metadata(): UnifiedNotification['notification_metadata'] {
      throw new Error('Read historical notification metadata');
    },
  }));
  const [records, setRecords] = createSignal<UnifiedNotification[]>([
    ...history,
    reply,
  ]);
  const [messageIds, setMessageIds] = createSignal(['root-1']);
  const globalRead = vi.fn(() => {
    throw new Error('Read global notifications');
  });
  const bulkMarkAsRead = vi.fn(async () => {
    setRecords([...history, { ...reply, state: 'seen' }]);
  });
  mocks.source.mockReturnValue({
    notificationsByEntity: globalRead,
    withLocalOverrides: (n: UnifiedNotification) => n,
    bulkMarkAsRead,
  });
  mocks.query.mockReturnValue({
    isEnabled: true,
    isPending: false,
    get data() {
      return records();
    },
  });
  const view = render(() => (
    <ChannelUnreadNotifications
      channelId="channel"
      messages={() => []}
      scrollState={() => undefined}
      container={() => undefined}
      insets={() => ({ start: 0, end: 0 })}
    >
      {() => (
        <For each={messageIds()}>
          {(messageId) => (
            <MarkMessageNotifications
              messageId={messageId}
              parent={{ type: 'channel', id: 'channel' }}
            >
              <span>{messageId}</span>
            </MarkMessageNotifications>
          )}
        </For>
      )}
    </ChannelUnreadNotifications>
  ));
  const initialReads = readMetadata.mock.calls.length;
  expect(initialReads).toBeGreaterThan(0);
  expect(bulkMarkAsRead).not.toHaveBeenCalled();

  setMessageIds(Array.from({ length: 50 }, (_, index) => `other-${index}`));
  expect(view.container.querySelectorAll('span')).toHaveLength(50);
  expect(readMetadata).toHaveBeenCalledTimes(initialReads);
  expect(bulkMarkAsRead).not.toHaveBeenCalled();

  setMessageIds([...messageIds(), 'reply-12']);
  await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());
  expect(bulkMarkAsRead).toHaveBeenCalledWith([reply]);
  expect(globalRead).not.toHaveBeenCalled();
});

it('updates one chip live without suspending the channel or loading the global feed', () => {
  const [pending, setPending] = createSignal(true);
  const [notifications, setNotifications] = createSignal<UnifiedNotification[]>(
    []
  );
  const [seen, setSeen] = createSignal(false);
  const globalRead = vi.fn(() => {
    throw new Error('Read global notifications');
  });
  mocks.source.mockReturnValue({
    notificationsByEntity: globalRead,
    withLocalOverrides: (n: UnifiedNotification) =>
      seen() ? { ...n, state: 'seen' } : n,
  });
  mocks.query.mockReturnValue({
    isEnabled: true,
    get isPending() {
      return pending();
    },
    get data() {
      if (pending()) throw new Error('Read pending notifications');
      return notifications();
    },
  });
  const messages = [1, 2, 3].map(
    (i) =>
      ({
        id: `root-${i}`,
        created_at: `2026-08-0${i}T00:00:00Z`,
      }) as MessageListItem
  );
  const navigate = vi.fn();
  const view = render(() => (
    <ChannelUnreadNotifications
      channelId="channel"
      messages={() => messages}
      scrollState={() => ({
        didInitialScroll: true,
        visibleRange: { first: 'root-2', last: 'root-2' },
        isNearBottom: false,
        isScrollingDown: false,
        distanceFromBottom: 500,
        distanceFromTop: 500,
        viewportSize: 500,
      })}
      container={() => undefined}
      insets={() => ({ start: 0, end: 0 })}
    >
      {(chip) => (
        <>
          <p>Channel messages</p>
          <Show when={chip()}>
            {(value) => (
              <UnreadNotificationsOverlay
                direction={value().direction}
                count={value().count}
                onClick={() => navigate(value().thread)}
              />
            )}
          </Show>
        </>
      )}
    </ChannelUnreadNotifications>
  ));
  expect(view.getByText('Channel messages')).toBeTruthy();
  expect(view.queryByRole('button')).toBeNull();
  setNotifications([notification('root-1', 12), notification('root-1', 13)]);
  setPending(false);
  expect(
    view.getByRole('button', { name: '1 unread notification stack above' })
  ).toBeTruthy();
  setNotifications([...notifications(), notification('root-3', 14)]);
  expect(view.getAllByRole('button')).toHaveLength(1);
  view
    .getByRole('button', { name: '2 unread notification stacks below' })
    .click();
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: 'root-3', messageId: 'reply-14' })
  );
  setSeen(true);
  expect(view.queryByRole('button')).toBeNull();
  expect(globalRead).not.toHaveBeenCalled();
});
