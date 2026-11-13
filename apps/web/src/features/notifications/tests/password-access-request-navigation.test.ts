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
  passwordsEnabled: true,
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
  enablePasswords: true,
  enableReminders: false,
  isFeatureEnabled: () => mocks.passwordsEnabled,
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
  entity_id: 'team-1',
  entity_type: 'team',
  notification_metadata: {
    tag: 'password_access_requested',
    content: {
      requestId: 'request-1',
      teamId: 'team-1',
      itemId: 'item-1',
      itemName: 'Deploy login',
    },
  },
} as UnifiedNotification;

const openWithSplit = vi.fn(() => ({ status: 'opened' as const }));
const layout = { openWithSplit } as unknown as SplitManager;

beforeEach(() => {
  openWithSplit.mockClear();
  mocks.passwordsEnabled = true;
});

it('opens Passwords on the requested item of its team, in a new split when asked', async () => {
  expect((await openNotification(notification, layout)).isOk()).toBe(true);
  expect(openWithSplit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: 'component',
      id: 'passwords',
      params: { teamId: 'team-1', itemId: 'item-1', requestId: 'request-1' },
    }),
    expect.objectContaining({ preferNewSplit: false })
  );

  expect((await openNotification(notification, layout, true)).isOk()).toBe(
    true
  );
  expect(openWithSplit).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'passwords' }),
    expect.objectContaining({ preferNewSplit: true })
  );
});

it('points an already open Passwords split at the requested item', async () => {
  const replace = vi.fn();
  openWithSplit.mockReturnValueOnce({
    status: 'reused',
    split: { replace },
  } as never);

  expect((await openNotification(notification, layout)).isOk()).toBe(true);

  expect(replace).toHaveBeenCalledExactlyOnceWith({
    next: expect.objectContaining({
      id: 'passwords',
      params: { teamId: 'team-1', itemId: 'item-1', requestId: 'request-1' },
    }),
    mergeHistory: true,
    referredFrom: null,
  });
});

it('opens nothing once Passwords is turned off', async () => {
  mocks.passwordsEnabled = false;

  await openNotification(notification, layout);

  expect(openWithSplit).not.toHaveBeenCalled();
});
