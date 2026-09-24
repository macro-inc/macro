import { createSplitLayout } from '@components/app/split-layout/layoutManager';
import { toast } from '@core/component/Toast/Toast';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { openNotification } from '../notification-navigation';
import type { UnifiedNotification } from '../types';

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: () => ({ element: undefined }),
}));
vi.mock('@core/constant/settingsTabsConfig', () => ({
  settingsTabToSlug: (tab: string) => tab,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { alert: vi.fn() } }));
vi.mock('@app/features/calendar-view/calendar-range', () => ({
  createCalendarRange: vi.fn(),
}));
vi.mock('@app/features/calendar-view/calendar-navigation', () => ({
  openCalendarView: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: () => false,
  itemToBlockName: (value: { fileType: string }) => value.fileType,
  resolveBlockAlias: (type: string) => type,
}));

beforeEach(() => vi.clearAllMocks());
vi.mock('@core/constant/featureFlags', () => ({
  enableCalendarUi: false,
  enableReminders: false,
  isFeatureEnabled: vi.fn(),
  USE_MACRO_PR_SUMMARY_BLOCK: true,
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@queries/notification/user-notifications', () => ({
  getNotificationById: vi.fn(),
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
    return createSplitLayout(orchestrator, [
      location === 'split'
        ? { type: 'channel', id: 'channel' }
        : { type: 'component', id: 'channels' },
      { type: 'component', id: 'inbox' },
    ]);
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
        ? {}
        : { channel_thread_id: 'thread' }),
    });

    release();
    await openNotification(notification, layout);
    expect(createBlockInstance).toHaveBeenCalledOnce();
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
    expect(navigate).toHaveBeenCalledWith({ channel_message_id: 'message' });
  }
);
