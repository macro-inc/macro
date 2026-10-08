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

const flags = vi.hoisted(() => ({ reminders: true }));
const getNotificationById = vi.hoisted(() => vi.fn());

vi.mock('@app/features/calendar-view/calendar-range', () => ({
  createCalendarRange: vi.fn(),
}));
vi.mock('@block-channel/utils/link', () => ({
  getChannelParams: vi.fn(),
  navigateToChannelMessage: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (value: { fileType: string }) => value.fileType,
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableCalendarUi: { key: 'enable-calendar-ui' },
  enableReminders: { key: 'enable-reminders' },
  isFeatureEnabled: (flag: { key: string }) =>
    flag.key === 'enable-reminders' && flags.reminders,
  USE_MACRO_PR_SUMMARY_BLOCK: true,
}));
vi.mock('@core/util/url', () => ({
  buildSimpleEntityUrl: ({ type, id }: { type: string; id: string }) =>
    `https://macro.com/app/${type}/${id}`,
  openExternalUrl: vi.fn(),
}));
vi.mock('@queries/notification/user-notifications', () => ({
  getNotificationById,
}));

import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openNotification,
  openNotificationFromId,
} from '../notification-navigation';
import type { NotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

function reminderNotification(): UnifiedNotification {
  return {
    entity_id: 'thread-1',
    entity_type: 'email_thread',
    notification_event_type: 'reminder',
    notification_metadata: {
      tag: 'reminder',
      content: {
        description: 'Review the reminder navigation',
        reminderId: 'reminder-1',
      },
    },
  } as UnifiedNotification;
}

describe('reminder notification navigation', () => {
  const openWithSplit = vi.fn();
  const layout = {
    getSplitByContent: vi.fn(() => undefined),
    openWithSplit,
  } as unknown as SplitManager;
  beforeEach(() => {
    flags.reminders = true;
    openWithSplit.mockReset();
    getNotificationById.mockReset();
  });

  it('opens the original email thread', async () => {
    const result = await openNotification(reminderNotification(), layout);
    expect(result.isOk()).toBe(true);
    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'email', id: 'thread-1' },
      expect.objectContaining({ activate: true })
    );
  });

  it('keeps delivered email reminders navigable after disabling creation', async () => {
    flags.reminders = false;
    await openNotification(reminderNotification(), layout);
    expect(openWithSplit).toHaveBeenCalledOnce();
  });

  it('reports acceptance only after the email route is applied', async () => {
    const onApplied = vi.fn();
    await openNotification(
      reminderNotification(),
      layout,
      false,
      undefined,
      undefined,
      { onApplied }
    );
    expect(onApplied).not.toHaveBeenCalled();
    openWithSplit.mock.calls[0][1].onApplied();
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it('does not reopen a removed generic reminder surface', async () => {
    const notification = {
      ...reminderNotification(),
      entity_type: 'reminder',
    } as UnifiedNotification;
    await openNotification(notification, layout);
    expect(openWithSplit).not.toHaveBeenCalled();
  });

  it('does not open a fetched reminder after its route host becomes stale', async () => {
    getNotificationById.mockResolvedValue(reminderNotification());
    const source = { notifications: () => [] } as unknown as NotificationSource;
    const result = await openNotificationFromId(
      'notification-1',
      layout,
      source,
      { canOpen: () => false }
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      tag: 'NavigationDeferredError',
      notificationId: 'notification-1',
    });
    expect(openWithSplit).not.toHaveBeenCalled();
  });
});
