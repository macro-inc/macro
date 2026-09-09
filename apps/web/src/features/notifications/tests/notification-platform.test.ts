import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { checkEmailNotificationSignal } from '@queries/notification/email-signal';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformNotificationState } from '../components/PlatformNotificationProvider';
import type { PlatformNotificationHandle } from '../notification-platform';
import type { UnifiedNotification } from '../types';

vi.mock('@queries/notification/email-signal', () => ({
  checkEmailNotificationSignal: vi.fn(),
}));

vi.mock('@app/util/favicon', () => ({
  getFaviconUrl: () => 'favicon.ico',
}));

vi.mock('@macro-inc/lexical-core', () => ({
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

function createEmailNotification(): UnifiedNotification {
  return baseNotification({
    entity_id: 'email-thread-1',
    entity_type: 'email_thread',
    notification_event_type: 'new_email',
    notification_metadata: {
      tag: 'new_email',
      content: {
        sender: 'Sender',
        toEmail: 'staff@macro.com',
        threadId: 'email-thread-1',
        subject: 'Email subject',
        snippet: 'Email snippet',
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

function createGithubPrCheckRunNotification(): UnifiedNotification {
  return baseNotification({
    entity_id: '123e4567-e89b-12d3-a456-426614174000',
    entity_type: 'foreign_entity',
    notification_event_type: 'github_pr_check_run',
    notification_metadata: {
      tag: 'github_pr_check_run',
      content: {
        checkName: 'CI / tests',
        checkRunGithubId: 987654321,
        checkStatus: 'completed',
        checkUrl: 'https://github.com/macro/macro/runs/987654321',
        completedAt: '2026-06-15T20:00:00Z',
        conclusion: 'success',
        displayName: 'macro/macro#42',
        foreignEntityId: '123e4567-e89b-12d3-a456-426614174000',
        githubKey: 'macro/macro/pull/42',
        number: 42,
        owner: 'macro',
        repo: 'macro',
        state: 'completed',
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
  beforeEach(() => {
    vi.mocked(checkEmailNotificationSignal).mockReset();
  });

  it('keeps non-Signal emails in-app without showing a browser popup', async () => {
    vi.mocked(checkEmailNotificationSignal).mockResolvedValue(ok(false));
    const notification = createEmailNotification();
    const original = structuredClone(notification);
    const showNotification = vi.fn();

    await maybeHandlePlatformNotification(
      notification,
      createNotificationInterface(showNotification),
      {} as SplitManager
    );

    expect(checkEmailNotificationSignal).toHaveBeenCalledWith('email-thread-1');
    expect(showNotification).not.toHaveBeenCalled();
    expect(notification).toEqual(original);
  });

  it('still shows Signal email popups', async () => {
    vi.mocked(checkEmailNotificationSignal).mockResolvedValue(ok(true));
    const handle = createNotificationHandle();
    const showNotification = vi.fn(async () => handle);

    await maybeHandlePlatformNotification(
      createEmailNotification(),
      createNotificationInterface(showNotification),
      {} as SplitManager
    );

    expect(showNotification).toHaveBeenCalledOnce();
    expect(handle.onClick).toHaveBeenCalledOnce();
  });

  it('waits for Signal membership before displaying an email popup', async () => {
    let resolveSignal!: (
      value: Awaited<ReturnType<typeof checkEmailNotificationSignal>>
    ) => void;
    vi.mocked(checkEmailNotificationSignal).mockReturnValue(
      new Promise((resolve) => {
        resolveSignal = resolve;
      })
    );
    const showNotification = vi.fn(async () => createNotificationHandle());
    const pending = maybeHandlePlatformNotification(
      createEmailNotification(),
      createNotificationInterface(showNotification),
      {} as SplitManager
    );

    expect(showNotification).not.toHaveBeenCalled();
    resolveSignal(ok(false));
    await pending;
    expect(showNotification).not.toHaveBeenCalled();
  });

  it.each(['result', 'exception'] as const)(
    'suppresses email popups on a lookup %s failure',
    async (failure) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const showNotification = vi.fn();
      if (failure === 'result') {
        vi.mocked(checkEmailNotificationSignal).mockResolvedValue(
          err([{ code: 'UNKNOWN', message: 'Lookup failed' }])
        );
      } else {
        vi.mocked(checkEmailNotificationSignal).mockRejectedValue(
          new Error('Lookup failed')
        );
      }

      try {
        await maybeHandlePlatformNotification(
          createEmailNotification(),
          createNotificationInterface(showNotification),
          {} as SplitManager
        );
        expect(showNotification).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce();
      } finally {
        warn.mockRestore();
      }
    }
  );

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

  it('skips GitHub PR check-run events as browser notifications', async () => {
    const showNotification = vi.fn<
      PlatformNotificationState['showNotification']
    >(async () => 'not-granted');
    const notificationInterface = createNotificationInterface(showNotification);

    await maybeHandlePlatformNotification(
      createGithubPrCheckRunNotification(),
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
    expect(checkEmailNotificationSignal).not.toHaveBeenCalled();
  });
});
