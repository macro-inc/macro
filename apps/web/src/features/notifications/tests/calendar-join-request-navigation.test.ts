vi.mock('../notification-helpers', () => ({
  isChannelNotification: () => false,
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

import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { beforeEach, expect, it, vi } from 'vitest';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  openCalendarView: vi.fn(),
  calendarEnabled: true,
}));

vi.mock('@app/features/calendar-view/calendar-range', () => ({
  createCalendarRange: vi.fn(),
}));
vi.mock('@app/features/calendar-view/calendar-navigation', () => ({
  openCalendarView: mocks.openCalendarView,
}));
vi.mock('@block-channel/utils/link', () => ({
  getChannelParams: vi.fn(),
  navigateToChannelMessage: vi.fn(),
}));
vi.mock('@channel/queries/prefetch-channel-target', () => ({
  prefetchChannelTarget: vi.fn(async () => {}),
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (value: { fileType: string }) => value.fileType,
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCalendarUi: true,
  enableReminders: false,
  isFeatureEnabled: () => mocks.calendarEnabled,
  USE_MACRO_PR_SUMMARY_BLOCK: true,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@queries/notification/user-notifications', () => ({
  getNotificationById: vi.fn(),
}));
vi.mock('@queries/reminders/reminders', () => ({ getReminderById: vi.fn() }));
vi.mock('../notification-resolvers', () => ({
  DefaultNotificationBlockNameResolver: vi.fn(),
}));

import { openNotification } from '../notification-navigation';

const notification = {
  entity_id: 'shared-event',
  entity_type: 'calendar_event',
  notification_metadata: {
    tag: 'calendar_event_join_request',
    content: {
      requestId: 'request-1',
      eventId: 'shared-event',
      title: 'Offsite',
    },
  },
} as UnifiedNotification;

const layout = {} as SplitManager;

beforeEach(() => {
  mocks.openCalendarView.mockClear();
  mocks.calendarEnabled = true;
});

it('opens the calendar on the shared event, in a new split when asked', async () => {
  expect((await openNotification(notification, layout)).isOk()).toBe(true);
  expect(mocks.openCalendarView).toHaveBeenLastCalledWith(
    { eventId: 'shared-event' },
    expect.objectContaining({ manager: layout, openInNewSplit: false })
  );

  expect((await openNotification(notification, layout, true)).isOk()).toBe(
    true
  );
  expect(mocks.openCalendarView).toHaveBeenLastCalledWith(
    { eventId: 'shared-event' },
    expect.objectContaining({ openInNewSplit: true })
  );
});

it('opens nothing once the calendar is turned off', async () => {
  mocks.calendarEnabled = false;

  await openNotification(notification, layout);

  expect(mocks.openCalendarView).not.toHaveBeenCalled();
});
