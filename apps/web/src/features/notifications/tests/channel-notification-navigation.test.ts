import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { createRoutedSplitLayout } from '@components/app/split-layout/tests/fixtures';
import { toast } from '@core/component/Toast/Toast';
import {
  enableWhatsappLinked,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { BlockOrchestrator } from '@core/orchestrator';
import { getNotificationById } from '@queries/notification/user-notifications';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import {
  openNotification,
  openNotificationFromId,
} from '../notification-navigation';
import {
  pendingNotificationNavigation,
  receiveNotificationTap,
  setPendingNotificationNavigationId,
} from '../notification-navigation-intent';
import { endNotificationOpen } from '../notification-open-trace';
import type { NotificationSource } from '../notification-source';
import { usePendingNotificationNavigationEffect } from '../PendingNotificationNavigationEffect';
import type { UnifiedNotification } from '../types';

// Keep the actual navigation functions without loading unrelated barrel exports.
vi.mock('@notifications', async () => import('../notification-navigation'));
vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: () => ({ element: undefined }),
}));
vi.mock('@core/constant/settingsTabsConfig', () => ({
  settingsTabToSlug: (tab: string) => tab,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: vi.fn(), failure: vi.fn() },
}));
vi.mock('@app/features/calendar-view/calendar-range', () => ({
  createCalendarRange: vi.fn(),
}));
vi.mock('@app/features/calendar-view/calendar-navigation', () => ({
  openCalendarView: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: { channel: {} },
  isBlockAlias: () => false,
  itemToBlockName: (value: { fileType: string }) => value.fileType,
  resolveBlockAlias: (type: string) => type,
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  setGlobalSplitManager(undefined);
  setPendingNotificationNavigationId(undefined);
  endNotificationOpen('test_complete');
});
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableCalendarUi: false,
  enableReminders: false,
  isFeatureEnabled: vi.fn(),
  USE_MACRO_PR_SUMMARY_BLOCK: true,
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@queries/notification/user-notifications', () => ({
  getNotificationById: vi.fn(),
}));
vi.mock('@channel/queries/prefetch-channel-target', () => ({
  prefetchChannelTarget: vi.fn(async () => {}),
}));
vi.mock('@queries/reminders/reminders', () => ({ getReminderById: vi.fn() }));
vi.mock('../notification-resolvers', () => ({
  DefaultNotificationBlockNameResolver: vi.fn(),
}));
vi.mock('../notification-helpers', () => ({
  isChannelNotification: (notification: UnifiedNotification) =>
    [
      'channel_message_send',
      'channel_message_reply',
      'channel_mention',
    ].includes(notification.notification_metadata.tag),
}));
vi.mock('../notification-source', () => ({
  CHANNEL_EVENT_TYPES: [
    'channel_mention',
    'channel_message_send',
    'channel_message_reply',
    'document_mention',
  ],
}));
vi.mock('../notification-stacking', () => ({
  getMostRecentNotification: vi.fn(),
  stackNotifications: vi.fn(),
}));

function setup(location: 'preview' | 'split' | 'closed') {
  const navigate = vi.fn();
  const createBlockInstance = vi.fn(() => ({
    element: undefined,
    dispose: vi.fn(),
    detach: vi.fn(),
  }));
  const orchestrator = {
    createBlockInstance,
    getBlockHandle: async () => ({ goToLocationFromParams: navigate }),
  } as unknown as BlockOrchestrator;
  const layout = createRoot((dispose) => {
    onTestFinished(dispose);
    return createRoutedSplitLayout(
      orchestrator,
      location === 'split' ? '/channel/channel/~/home' : '/channels/~/home'
    );
  });
  const [first, other] = layout.splits();
  layout.activateSplit(other.id);
  const activate = vi.fn(() => layout.activateSplit(first.id));
  const release = layout.registerOpenViews(() =>
    location === 'preview'
      ? [
          {
            owner: 'chat',
            content: { type: 'channel', id: 'channel' },
            activate,
          },
        ]
      : []
  );
  return { layout, activate, navigate, release, createBlockInstance, first };
}

it.each([
  'channel_message_send',
  'channel_message_reply',
  'channel_mention',
] as const)(
  'reuses the Chat preview for %s and navigates to the notification target',
  async (tag) => {
    const { layout, activate, navigate, release, createBlockInstance, first } =
      setup('preview');
    const notification = {
      entity_id: 'channel',
      notification_metadata: {
        tag,
        content: { messageId: 'message', threadId: 'thread' },
      },
    } as UnifiedNotification;

    const result = await openNotification(notification, layout);

    expect(result.isOk()).toBe(true);
    expect(activate).toHaveBeenCalledOnce();
    expect(layout.activeSplitId()).toBe(first.id);
    expect(createBlockInstance).not.toHaveBeenCalled();
    expect(toast.alert).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({
      channel_message_id: 'message',
      ...(tag === 'channel_message_send'
        ? { channel_thread_id: 'message' }
        : { channel_thread_id: 'thread' }),
    });

    release();
    await openNotification(notification, layout);
    expect(createBlockInstance).toHaveBeenCalledOnce();
  }
);

it('opens a direct push target without looking up the notification or loading the feed', async () => {
  const { layout, navigate } = setup('closed');
  const notifications = vi.fn();
  const source = { notifications } as unknown as NotificationSource;
  const onApplied = vi.fn();
  const result = await openNotificationFromId('notification', layout, source, {
    target: {
      type: 'channel',
      channelId: 'channel',
      messageId: 'message',
      threadId: null,
    },
    onApplied,
  });
  expect(result.isOk()).toBe(true);
  expect(notifications).not.toHaveBeenCalled();
  expect(getNotificationById).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledWith({
    channel_message_id: 'message',
    channel_thread_id: 'message',
  });
  expect(onApplied).toHaveBeenCalledOnce();
});

it('acknowledges a failed lookup and opens the next native tap', async () => {
  const { layout } = setup('closed');
  const lookup = Promise.withResolvers<UnifiedNotification | undefined>();
  vi.mocked(getNotificationById).mockReturnValueOnce(lookup.promise);
  const source = { notifications: () => [] };
  createRoot((dispose) => {
    onTestFinished(dispose);
    usePendingNotificationNavigationEffect(
      source,
      () => 'macro|test@example.com'
    );
  });
  setGlobalSplitManager(layout);
  const failedAck = Promise.withResolvers<void>();
  const nextAck = Promise.withResolvers<void>();
  const acknowledge = vi.fn(async (deliveryId: string) => {
    if (deliveryId === 'failed-delivery') failedAck.resolve();
    if (deliveryId === 'next-delivery') nextAck.resolve();
  });
  receiveNotificationTap(
    {
      type: 'BACKGROUND_TAP',
      payload: { notificationId: 'failed-notification' },
      deliveryId: 'failed-delivery',
    },
    acknowledge
  );
  lookup.reject(new Error('notification lookup unavailable'));
  await failedAck.promise;
  await Promise.resolve();
  expect(acknowledge).toHaveBeenCalledWith('failed-delivery');
  expect(pendingNotificationNavigation()).toBeUndefined();
  expect(toast.failure).toHaveBeenCalledOnce();
  expect(layout.getSplitByContent('channel', 'channel')).toBeUndefined();

  vi.mocked(getNotificationById).mockResolvedValueOnce({
    id: 'next-notification',
    entity_id: 'channel',
    entity_type: 'channel',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    notification_event_type: 'channel_invite',
    notification_metadata: {
      tag: 'channel_invite',
      content: { invitedBy: 'macro|sender@example.com' },
    },
    state: 'unseen',
    sent: true,
  });
  receiveNotificationTap(
    {
      type: 'BACKGROUND_TAP',
      payload: { notificationId: 'next-notification' },
      deliveryId: 'next-delivery',
    },
    acknowledge
  );
  await nextAck.promise;
  await Promise.resolve();
  expect(acknowledge).toHaveBeenCalledWith('next-delivery');
  expect(pendingNotificationNavigation()).toBeUndefined();
  expect(layout.getSplitByContent('channel', 'channel')).toBeDefined();
});

it.each(['direct', 'cached'] as const)(
  'reports a rejected %s destination through the error result',
  async (kind) => {
    const { layout } = setup('closed');
    const failure = new Error('destination unavailable');
    vi.spyOn(layout, 'openWithSplit').mockImplementationOnce(() => {
      throw failure;
    });
    const notification: UnifiedNotification = {
      id: 'notification',
      entity_id: 'channel',
      entity_type: 'channel',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      notification_event_type: 'channel_invite',
      notification_metadata: {
        tag: 'channel_invite',
        content: { invitedBy: 'macro|sender@example.com' },
      },
      state: 'unseen',
      sent: true,
    };
    const source = { notifications: () => [notification] };
    const onApplied = vi.fn();
    const failed = vi.fn();
    await openNotificationFromId('notification', layout, source, {
      onApplied,
      ...(kind === 'direct'
        ? {
            target: {
              type: 'channel' as const,
              channelId: 'channel',
              messageId: 'message',
              threadId: null,
            },
          }
        : {}),
    }).match(() => {}, failed);
    expect(failed).toHaveBeenCalledWith({
      tag: 'NavigationFailedError',
      cause: failure,
    });
    expect(onApplied).not.toHaveBeenCalled();
  }
);

it.each(['channel_invite', 'call_started'] as const)(
  'activates the existing preview for %s without opening a split',
  async (tag) => {
    const { layout, activate, navigate, createBlockInstance } =
      setup('preview');
    await openNotification(
      {
        entity_id: 'channel',
        notification_metadata: { tag, content: {} },
      } as UnifiedNotification,
      layout
    );

    expect(activate).toHaveBeenCalledOnce();
    expect(createBlockInstance).not.toHaveBeenCalled();
    expect(toast.alert).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  }
);

it('reports an ordinary channel notification applied after preview activation', async () => {
  const { layout, activate } = setup('preview');
  const onApplied = vi.fn();

  await openNotification(
    {
      entity_id: 'channel',
      notification_metadata: { tag: 'channel_invite', content: {} },
    } as UnifiedNotification,
    layout,
    false,
    undefined,
    undefined,
    { onApplied }
  );

  expect(activate).toHaveBeenCalledOnce();
  expect(onApplied).toHaveBeenCalledOnce();
});

it.each(['split', 'closed'] as const)(
  'preserves notification navigation when the channel is %s',
  async (location) => {
    const { layout, navigate, createBlockInstance, first } = setup(location);
    await openNotification(
      {
        entity_id: 'channel',
        notification_metadata: {
          tag: 'channel_message_send',
          content: { messageId: 'message' },
        },
      } as UnifiedNotification,
      layout
    );

    expect(createBlockInstance).toHaveBeenCalledOnce();
    if (location === 'split') expect(layout.activeSplitId()).toBe(first.id);
    expect(toast.alert).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({
      channel_message_id: 'message',
      channel_thread_id: 'message',
    });
  }
);

it('opens an external chat notification in External without a channel block', async () => {
  vi.mocked(isFeatureEnabled).mockImplementation(
    (flag) => flag === enableWhatsappLinked
  );
  const { layout, createBlockInstance, navigate } = setup('closed');
  const open = vi.spyOn(layout, 'openWithSplit');
  await openNotification(
    {
      entity_id: '11111111-1111-4111-8111-111111111111',
      notification_metadata: {
        tag: 'external_chat_message',
        content: {
          provider: 'whatsapp',
          chatName: 'Family',
          messageId: 'message',
        },
      },
    } as UnifiedNotification,
    layout
  );
  expect(open).toHaveBeenCalledWith(
    {
      type: 'component',
      id: 'external',
      entryMetadata: {
        route: {
          matches: [
            expect.anything(),
            { id: 'view-external', params: {} },
            {
              id: 'external-chat',
              params: { chatId: '11111111-1111-4111-8111-111111111111' },
            },
          ],
        },
      },
    },
    expect.anything()
  );
  expect(createBlockInstance).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

it('keeps external chat notifications behind the existing feature flag', async () => {
  vi.mocked(isFeatureEnabled).mockReturnValue(false);
  const { layout, createBlockInstance } = setup('closed');
  const open = vi.spyOn(layout, 'openWithSplit');
  await openNotification(
    {
      entity_id: '11111111-1111-4111-8111-111111111111',
      notification_metadata: {
        tag: 'external_chat_message',
        content: {
          provider: 'whatsapp',
          chatName: 'Family',
          messageId: 'message',
        },
      },
    } as UnifiedNotification,
    layout
  );
  expect(open).not.toHaveBeenCalled();
  expect(createBlockInstance).not.toHaveBeenCalled();
});
