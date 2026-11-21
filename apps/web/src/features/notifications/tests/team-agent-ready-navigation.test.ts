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
  getOrCreate: vi.fn(),
}));

vi.mock('@app/features/calendar-view/calendar-range', () => ({
  createCalendarRange: vi.fn(),
}));
vi.mock('@app/features/calendar-view/calendar-navigation', () => ({
  openCalendarView: vi.fn(),
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
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enableReminders: false,
  isFeatureEnabled: () => true,
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

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getOrCreateDirectMessage: mocks.getOrCreate },
}));
// Signed in as the agent's inviter.
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => ({ userId: 'macro|maya@example.com', session: 1 }),
  isCurrentQueryAccount: (account?: { userId: string }) =>
    account?.userId === 'macro|maya@example.com',
}));
vi.mock('@queries/channel/channels', () => ({
  invalidateListChannels: () => Promise.resolve(),
}));

import { ok } from 'neverthrow';
import { openNotification } from '../notification-navigation';

// An agent teammate came online; its inviter's inbox shows this.
const notification = {
  entity_id: 'team-1',
  entity_type: 'team',
  notification_metadata: {
    tag: 'computer_setup',
    content: {
      computerId: 'computer-ada',
      harnessId: 'harness-ada',
      computerName: 'Ada',
      agent: { userId: 'macro|ada@agents.macro.invalid', name: 'Ada' },
      outcome: { kind: 'ready' },
    },
  },
} as UnifiedNotification;

beforeEach(() => {
  mocks.getOrCreate.mockReset();
});

it("opens a ready agent teammate's real DM, where its greeting lands", async () => {
  mocks.getOrCreate.mockResolvedValue(ok({ channel_id: 'channel-ada' }));
  const openWithSplit = vi.fn(() => ({ status: 'opened' }));
  const layout = { openWithSplit } as unknown as SplitManager;

  expect((await openNotification(notification, layout)).isOk()).toBe(true);

  expect(openWithSplit).toHaveBeenCalledWith(
    { type: 'channel', id: 'channel-ada' },
    expect.objectContaining({ activate: true })
  );
  expect(mocks.getOrCreate).toHaveBeenCalledWith({
    recipient_id: 'macro|ada@agents.macro.invalid',
  });
});
