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

vi.mock('@block-calendar/calendar-range', () => ({
  createCalendarBlockRange: vi.fn(),
}));
vi.mock('@block-channel/utils/link', () => ({
  getChannelParams: vi.fn(),
  navigateToChannelMessage: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (value: { fileType: string }) => value.fileType,
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@core/constant/featureFlags', () => ({
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
  getNotificationById: vi.fn(),
}));
vi.mock('../notification-resolvers', () => ({
  DefaultNotificationBlockNameResolver: vi.fn(),
}));

import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openNotification } from '../notification-navigation';
import type { UnifiedNotification } from '../types';

function reminderNotification(): UnifiedNotification {
  return {
    entity_id: 'reminder-1',
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
  beforeEach(() => {
    flags.reminders = true;
  });

  it('opens source-less reminders in their detail component without resolving a document', async () => {
    const openWithSplit = vi.fn();
    const getOrchestrator = vi.fn();
    const layout = {
      getSplitByContent: vi.fn(() => undefined),
      openWithSplit,
      getOrchestrator,
    } as unknown as SplitManager;

    const result = await openNotification(reminderNotification(), layout);

    expect(result.isOk()).toBe(true);
    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'component', id: 'reminder-view~reminder-1' },
      expect.objectContaining({ activate: true })
    );
    expect(getOrchestrator).not.toHaveBeenCalled();
  });

  it('does not open a reminder destination while the feature is disabled', async () => {
    flags.reminders = false;
    const openWithSplit = vi.fn();
    const layout = {
      getSplitByContent: vi.fn(() => undefined),
      openWithSplit,
    } as unknown as SplitManager;

    await openNotification(reminderNotification(), layout);

    expect(openWithSplit).not.toHaveBeenCalled();
  });
});
