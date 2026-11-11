const mocks = vi.hoisted(() => ({
  writeText: vi.fn<(text: string) => Promise<void>>(),
  success: vi.fn(),
  remindersEnabled: true,
}));

vi.mock('@app/features/calendar-view/copy-event-mention', () => ({
  copyCalendarEventMentionTarget: vi.fn(),
}));
vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: vi.fn(() => ({ type: 'mock-component' })),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
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

import {
  createRoutesManifest,
  decodePane,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  emailSplitRoute,
  emailThreadRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import type { UnifiedNotification } from '@notifications';
import { beforeEach, expect, it, vi } from 'vitest';
import { copyNotificationLink } from './notification-copy-link';

const routes = createRoutesManifest({
  definitions: [
    {
      ...appRoute,
      children: [
        { ...emailSplitRoute, children: [emailThreadRoute] },
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: emailSplitRoute.id, params: {} }),
} satisfies SplitRoutes);

const openedRoute = (link: string) => {
  const [root, ...segments] = new URL(link).pathname.split('/').filter(Boolean);
  expect(root).toBe('app');
  const leaf = decodePane(routes, segments)?.matches.at(-1);
  return leaf && { id: leaf.id, params: leaf.params };
};

beforeEach(() => {
  mocks.remindersEnabled = true;
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } });
});

it('copies a link that opens the reminded email thread', async () => {
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

  expect(mocks.writeText).toHaveBeenCalledOnce();
  expect(openedRoute(mocks.writeText.mock.calls[0]![0])).toEqual({
    id: emailThreadRoute.id,
    params: { threadId: 'thread-1' },
  });
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
