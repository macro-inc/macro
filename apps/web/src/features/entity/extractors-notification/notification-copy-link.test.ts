const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  success: vi.fn(),
  remindersEnabled: true,
}));

vi.mock('@app/features/calendar-view/copy-event-mention', () => ({
  copyCalendarEventMentionTarget: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success },
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
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

it('copies the original email URL', async () => {
  const notification = {
    entity_id: 'thread-1',
    entity_type: 'email_thread',
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
    'https://macro.com/app/email/thread-1'
  );
  expect(mocks.success).toHaveBeenCalledWith('Link copied to clipboard');
});

it('does not expose a legacy generic reminder URL', async () => {
  const notification = {
    entity_id: 'reminder-1',
    entity_type: 'reminder',
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
