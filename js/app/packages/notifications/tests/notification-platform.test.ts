import type { SplitManager } from '@app/component/split-layout/layoutManager';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformNotificationState } from '../components/PlatformNotificationProvider';
import type { PlatformNotificationHandle } from '../notification-platform';
import type { UnifiedNotification } from '../types';

vi.mock('@app/util/favicon', () => ({
  getFaviconUrl: () => 'favicon.ico',
}));

vi.mock('@lexical-core', () => ({
  markdownToPlainText: (content: string) => content,
}));

vi.mock('../../theme/signals/themeReactive', () => ({
  themeReactive: {
    a0: {
      l: [() => '0.8'],
      c: [() => '0.1'],
      h: [() => '100'],
    },
  },
}));

vi.mock('../notification-navigation', () => ({
  openNotification: vi.fn(),
}));

vi.mock('../notification-resolvers', () => ({
  DefaultDocumentNameResolver: vi.fn(async () => undefined),
  DefaultUserNameResolver: vi.fn(async () => undefined),
}));

import { maybeHandlePlatformNotification } from '../notification-platform';

function baseNotification(
  overrides: Partial<UnifiedNotification>
): UnifiedNotification {
  const now = new Date().toISOString();

  return {
    id: 'notification-1',
    entity_id: 'entity-1',
    entity_type: 'channel',
    created_at: now,
    updated_at: now,
    viewed_at: null,
    deleted_at: null,
    done: false,
    sent: true,
    sender_id: null,
    ...overrides,
  } as UnifiedNotification;
}

function createChannelInviteNotification(): UnifiedNotification {
  return baseNotification({
    notification_event_type: 'channel_invite',
    notification_metadata: {
      tag: 'channel_invite',
      content: {
        channelName: 'General',
        invitedBy: 'user-1',
      },
    },
  });
}

function createGithubPrNotification(): UnifiedNotification {
  return baseNotification({
    entity_id: '123e4567-e89b-12d3-a456-426614174000',
    entity_type: 'foreign_entity',
    notification_event_type: 'github_pr_status_changed',
    notification_metadata: {
      tag: 'github_pr_status_changed',
      content: {
        action: 'opened',
        displayName: 'macro/macro#42',
        foreignEntityId: '123e4567-e89b-12d3-a456-426614174000',
        githubKey: 'macro/macro/pull/42',
        number: 42,
        owner: 'macro',
        repo: 'macro',
        status: 'open',
        title: 'Add notification support',
        url: 'https://github.com/macro/macro/pull/42',
      },
    },
  });
}

function createNotificationInterface(
  showNotification: PlatformNotificationState['showNotification']
): PlatformNotificationState {
  return {
    permission: () => 'granted',
    requestPermission: async () => 'granted',
    unregisterNotification: async () => undefined,
    showNotification,
  };
}

function createNotificationHandle(): PlatformNotificationHandle {
  return {
    onClick: vi.fn(),
    onDismiss: vi.fn(),
    close: vi.fn(),
  };
}

describe('maybeHandlePlatformNotification', () => {
  it('skips GitHub PR events so they do not render as browser notifications', async () => {
    const showNotification = vi.fn<
      PlatformNotificationState['showNotification']
    >(async () => 'not-granted');
    const notificationInterface = createNotificationInterface(showNotification);

    await maybeHandlePlatformNotification(
      createGithubPrNotification(),
      notificationInterface,
      {} as SplitManager
    );

    expect(showNotification).not.toHaveBeenCalled();
  });

  it('still renders non-GitHub browser notifications', async () => {
    const handle = createNotificationHandle();
    const showNotification = vi.fn<
      PlatformNotificationState['showNotification']
    >(async () => handle);
    const notificationInterface = createNotificationInterface(showNotification);

    await maybeHandlePlatformNotification(
      createChannelInviteNotification(),
      notificationInterface,
      {} as SplitManager
    );

    expect(showNotification).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Someone <General>',
        options: expect.objectContaining({
          body: 'invited you to',
        }),
      })
    );
    expect(handle.onClick).toHaveBeenCalledOnce();
  });
});
