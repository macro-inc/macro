const mocks = vi.hoisted(() => ({
  remindersEnabled: true,
  success: vi.fn(),
  writeText: vi.fn(),
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
vi.mock('@core/util/url', () => ({
  buildSimpleEntityUrl: ({ type, id }: { type: string; id: string }) =>
    `https://macro.com/app/${type}/${id}`,
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('../utils', () => ({ calendarEventLinkTarget: vi.fn() }));

import type { EntityData } from '@entity';
import { beforeEach, expect, it, vi } from 'vitest';
import { makeCopyLinkAction } from './make-copy-link-action';

const reminder = {
  id: 'reminder-1',
  type: 'reminder',
  name: 'Review route links',
} as EntityData;

beforeEach(() => {
  mocks.remindersEnabled = true;
  mocks.success.mockClear();
  mocks.writeText.mockClear();
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } });
});

it('copies the canonical reminder route while the feature is enabled', async () => {
  const action = makeCopyLinkAction();

  expect(action.canExecute(reminder)).toBe(true);
  await action.execute([reminder]);

  expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith(
    'https://macro.com/app/reminder/reminder-1'
  );
  expect(mocks.success).toHaveBeenCalledWith('Link copied to clipboard');
});

it('does not expose a reminder route while the feature is disabled', async () => {
  mocks.remindersEnabled = false;
  const action = makeCopyLinkAction();

  expect(action.canExecute(reminder)).toBe(false);
  await action.execute([reminder]);

  expect(mocks.writeText).not.toHaveBeenCalled();
});
