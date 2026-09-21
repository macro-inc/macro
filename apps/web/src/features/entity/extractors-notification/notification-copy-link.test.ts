const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  success: vi.fn(),
  remindersEnabled: true,
}));

vi.mock('@block-calendar/copy-event-mention', () => ({
  copyCalendarEventMentionTarget: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success },
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableReminders: { key: 'enable-reminders' },
  isFeatureEnabled: () => mocks.remindersEnabled,
}));
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
}));
vi.mock('@notifications', () => ({
  getChannelNotificationParams: () => ({}),
}));

import type { UnifiedNotification } from '@notifications';
import { beforeEach, expect, it, vi } from 'vitest';
import { copyNotificationLink } from './notification-copy-link';

beforeEach(() => {
  mocks.remindersEnabled = true;
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } });
});

it('copies the canonical reminder detail URL', async () => {
  const notification = {
    entity_id: 'reminder-1',
    notification_metadata: {
      tag: 'reminder',
      content: {
        description: 'Review copied links',
        reminderId: 'reminder-1',
      },
    },
  } as UnifiedNotification;

  await copyNotificationLink(notification);

  expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith(
    'https://macro.com/app/component/reminder-view~reminder-1'
  );
  expect(mocks.success).toHaveBeenCalledWith('Link copied to clipboard');
});

it('does not expose a reminder detail URL while reminders are disabled', async () => {
  mocks.remindersEnabled = false;
  const notification = {
    entity_id: 'reminder-1',
    notification_metadata: {
      tag: 'reminder',
      content: {
        description: 'Review copied links',
        reminderId: 'reminder-1',
      },
    },
  } as UnifiedNotification;

  await copyNotificationLink(notification);

  expect(mocks.writeText).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});
