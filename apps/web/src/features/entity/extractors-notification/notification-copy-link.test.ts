const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@block-calendar/copy-event-mention', () => ({
  copyCalendarEventMentionTarget: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success },
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
