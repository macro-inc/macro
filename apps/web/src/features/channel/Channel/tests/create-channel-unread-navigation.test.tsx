import {
  MarkMessageNotifications,
  MessageNotificationIndexContext,
} from '@notifications/components/MarkMessageNotifications';
import type { UnifiedNotification } from '@notifications/types';
import type { MessageListItem } from '@service-storage/messages';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal, For, Show } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { notifyElementOnMount } from '../../Thread/message-element-lifecycle';
import { ThreadCollapsedIndicator } from '../../Thread/ThreadCollapsedIndicator';
import { createChannelUnreadNavigation } from '../create-channel-unread-navigation';
import { UnreadNotificationsOverlay } from '../UnreadNotificationsOverlay';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));

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
  const view = render(() => {
    const unread = createChannelUnreadNavigation({
      channelId: 'channel',
      messages: () => [],
      scrollState: () => undefined,
      onDestinationsChanged: () => {},
      container: () => undefined,
      insets: () => ({ start: 0, end: 0 }),
    });
    return (
      <MessageNotificationIndexContext.Provider value={unread.unreadByMessage}>
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
      </MessageNotificationIndexContext.Provider>
    );
  });
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
  const view = render(() => {
    const unread = createChannelUnreadNavigation({
      channelId: 'channel',
      messages: () => messages,
      scrollState: () => ({
        didInitialScroll: true,
        visibleRange: { first: 'root-2', last: 'root-2' },
        isNearBottom: false,
        isScrollingDown: false,
        distanceFromBottom: 500,
        distanceFromTop: 500,
        viewportSize: 500,
      }),
      onDestinationsChanged: () => {},
      container: () => undefined,
      insets: () => ({ start: 0, end: 0 }),
    });
    return (
      <>
        <p>Channel messages</p>
        <Show when={unread.chip()}>
          {(value) => (
            <UnreadNotificationsOverlay
              direction={value().direction}
              count={value().count}
              onClick={() => navigate(value().thread)}
            />
          )}
        </Show>
      </>
    );
  });
  expect(view.getByText('Channel messages')).toBeTruthy();
  expect(view.queryByRole('button')).toBeNull();
  setNotifications([notification('root-1', 12), notification('root-1', 13)]);
  setPending(false);
  expect(
    view.getByRole('button', {
      name: '1 unread notification stack above',
    })
  ).toBeTruthy();
  setNotifications([...notifications(), notification('root-3', 14)]);
  expect(view.getAllByRole('button')).toHaveLength(1);
  view
    .getByRole('button', {
      name: '2 unread notification stacks below',
    })
    .click();
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: 'root-3', messageId: 'reply-14' })
  );
  setSeen(true);
  expect(view.queryByRole('button')).toBeNull();
  expect(globalRead).not.toHaveBeenCalled();
});

it('hands off to the inline unread indicator, keeps other offscreen threads reachable, and only marks rendered replies seen', async () => {
  const [records, setRecords] = createSignal<UnifiedNotification[]>([]);
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const [expanded, setExpanded] = createSignal(false);
  const [scrollTick, setScrollTick] = createSignal(0);
  let disclosureTop = 350;
  const bulkMarkAsRead = vi.fn(async (seen: UnifiedNotification[]) => {
    const ids = new Set(seen.map((n) => n.id));
    setRecords((current) =>
      current.map((n) => (ids.has(n.id) ? { ...n, state: 'seen' } : n))
    );
  });
  mocks.source.mockReturnValue({
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
  const messages = [1, 2, 3].map(
    (i) =>
      ({
        id: `root-${i}`,
        created_at: `2026-08-0${i}T00:00:00Z`,
      }) as MessageListItem
  );
  const view = render(() => {
    const unread = createChannelUnreadNavigation({
      channelId: 'channel',
      messages: () => messages,
      container,
      onDestinationsChanged: () =>
        queueMicrotask(() => setScrollTick((tick) => tick + 1)),
      insets: () => ({ start: 20, end: 80 }),
      scrollState: () => ({
        didInitialScroll: true,
        visibleRange: { first: 'root-2', last: 'root-3' },
        isNearBottom: true,
        isScrollingDown: false,
        distanceFromBottom: 0,
        distanceFromTop: scrollTick(),
        viewportSize: 400,
      }),
    });
    return (
      <div ref={setContainer}>
        <MessageNotificationIndexContext.Provider
          value={unread.unreadByMessage}
        >
          <div
            data-channel-scroll
            ref={(el) => {
              el.getBoundingClientRect = () => new DOMRect(0, 100, 500, 400);
            }}
          >
            <Show
              when={!expanded()}
              fallback={
                <MarkMessageNotifications
                  messageId="reply-14"
                  parent={{ type: 'channel', id: 'channel' }}
                >
                  <div
                    ref={(element) =>
                      notifyElementOnMount(
                        unread.onMessageMount,
                        'reply-14',
                        element
                      )
                    }
                  >
                    Unread reply content
                  </div>
                </MarkMessageNotifications>
              }
            >
              <ThreadCollapsedIndicator
                ref={(el) => {
                  el.getBoundingClientRect = () =>
                    new DOMRect(0, disclosureTop, 200, 32);
                  notifyElementOnMount(unread.onDisclosureMount, 'root-3', el);
                }}
                hasUnreadNotifications={unread.unreadByThread().has('root-3')}
                collapsedRepliesCount={24}
                participants={[]}
                onClick={() => setExpanded(true)}
              />
            </Show>
          </div>
          <Show when={unread.chip()}>
            {(value) => (
              <UnreadNotificationsOverlay
                direction={value().direction}
                count={value().count}
                onClick={() => setExpanded(true)}
              />
            )}
          </Show>
        </MessageNotificationIndexContext.Provider>
      </div>
    );
  });
  setRecords([notification('root-1', 12), notification('root-3', 14)]);
  await waitFor(() =>
    expect(view.getByText('Unread').classList.contains('sr-only')).toBe(true)
  );
  await waitFor(() =>
    expect(
      view.getByRole('button', {
        name: '1 unread notification stack above',
      })
    ).toBeTruthy()
  );
  expect(bulkMarkAsRead).not.toHaveBeenCalled();

  disclosureTop = 450; // Hidden behind the composer inset.
  setScrollTick((tick) => tick + 1);
  expect(
    view.getByRole('button', {
      name: '2 unread notification stacks below',
    })
  ).toBeTruthy();
  disclosureTop = 350;
  setScrollTick((tick) => tick + 1);
  expect(
    view.getByRole('button', {
      name: '1 unread notification stack above',
    })
  ).toBeTruthy();

  setRecords([notification('root-3', 14)]);
  await waitFor(() =>
    expect(view.queryByText('Unread notification')).toBeNull()
  );
  expect(
    view.getByTitle('Expand thread').querySelector('.bg-accent')
  ).not.toBeNull();
  expect(
    view.getByTitle('Expand thread').classList.contains('border-accent/40')
  ).toBe(true);
  expect(bulkMarkAsRead).not.toHaveBeenCalled();
  view.getByTitle('Expand thread').click();
  await waitFor(() => expect(bulkMarkAsRead).toHaveBeenCalledOnce());
  expect(bulkMarkAsRead).toHaveBeenCalledWith([notification('root-3', 14)]);
  expect(view.getByText('Unread reply content')).toBeTruthy();

  // A new notification after manual collapse restores the inline affordance.
  setExpanded(false);
  setRecords([notification('root-3', 15)]);
  await waitFor(() =>
    expect(view.getByText('Unread').classList.contains('sr-only')).toBe(true)
  );
  expect(view.queryByText('Unread notification')).toBeNull();
  expect(bulkMarkAsRead).toHaveBeenCalledOnce();
});

it('places the chip when an activity row is the first visible row', () => {
  mocks.source.mockReturnValue({
    notificationsByEntity: vi.fn(),
    withLocalOverrides: (n: UnifiedNotification) => n,
  });
  mocks.query.mockReturnValue({
    isEnabled: true,
    isPending: false,
    data: [notification('root-1', 12)],
  });
  const messages = [1, 3].map(
    (i) =>
      ({
        id: `root-${i}`,
        created_at: `2026-08-0${i}T00:00:00Z`,
      }) as MessageListItem
  );
  const activities = new Map([
    [
      'activity:joined',
      {
        id: 'joined',
        actor_id: 'macro|user@example.com',
        occurred_at: '2026-08-02T00:00:00Z',
        action: 'participant_added',
        payload: null,
      },
    ],
  ]);
  const view = render(() => {
    const unread = createChannelUnreadNavigation({
      channelId: 'channel',
      messages: () => messages,
      activities: () => activities,
      scrollState: () => ({
        didInitialScroll: true,
        visibleRange: { first: 'activity:joined', last: 'root-3' },
        isNearBottom: false,
        isScrollingDown: false,
        distanceFromBottom: 500,
        distanceFromTop: 500,
        viewportSize: 500,
      }),
      container: () => undefined,
      insets: () => ({ start: 0, end: 0 }),
      onDestinationsChanged: () => {},
    });
    return (
      <Show when={unread.chip()}>
        {(value) => (
          <UnreadNotificationsOverlay
            direction={value().direction}
            count={value().count}
            onClick={() => {}}
          />
        )}
      </Show>
    );
  });
  expect(
    view.getByRole('button', { name: '1 unread notification stack above' })
  ).toBeTruthy();
});
