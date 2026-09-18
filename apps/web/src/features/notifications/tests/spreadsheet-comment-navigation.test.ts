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
import { expect, it, vi } from 'vitest';
import type { UnifiedNotification } from '../types';

vi.mock('@block-calendar/calendar-range', () => ({
  createCalendarBlockRange: vi.fn(),
}));
vi.mock('@block-channel/utils/link', () => ({
  getChannelParams: vi.fn(),
  navigateToChannelMessage: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (value: { fileType: string }) => value.fileType,
  resolveBlockAlias: (type: string) => (type === 'task' ? 'md' : type),
}));
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

import { openNotification } from '../notification-navigation';

it.each([
  'commented_on_document',
  'mentioned_in_document_comment',
  'replied_to_document_comment_thread',
] as const)(
  'opens %s at the spreadsheet comment, including an already open sheet',
  async (tag) => {
    const navigate = vi.fn();
    const open = vi.fn();
    const activate = vi.fn();
    const layout = {
      getSplitByContent: vi.fn(() => undefined as unknown),
      openWithSplit: open,
      getOrchestrator: () => ({
        getBlockHandle: async () => ({ goToLocationFromParams: navigate }),
      }),
    };
    const notification = {
      entity_id: 'sheet-doc',
      notification_metadata: {
        tag,
        content: { fileType: 'spreadsheet', commentId: 42, threadId: 7 },
      },
    } as UnifiedNotification;
    const result = await openNotification(
      notification,
      layout as unknown as SplitManager
    );
    expect(result.isOk()).toBe(true);
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ comment_id: '42' })
    );
    expect(open).toHaveBeenCalledWith(
      { type: 'spreadsheet', id: 'sheet-doc' },
      expect.anything()
    );
    layout.getSplitByContent.mockReturnValue({ activate });
    open.mockClear();
    navigate.mockClear();
    await openNotification(notification, layout as unknown as SplitManager);
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ comment_id: '42' })
    );
    expect(activate).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  }
);
