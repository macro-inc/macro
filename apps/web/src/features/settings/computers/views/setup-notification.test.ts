/**
 * @vitest-environment jsdom
 */

import {
  computerSetupRequest,
  consumeComputerSetupRequest,
} from '@app/features/settings/computers/primitives/setup-request';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import {
  getNotificationAction,
  getNotificationContent,
} from '@notifications/notification-metadata';
import { openNotification } from '@notifications/notification-navigation';
import type { UnifiedNotification } from '@notifications/types';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));

const notice = (
  outcome: { kind: 'ready' } | { kind: 'failed'; failureReason: string }
): UnifiedNotification =>
  ({
    id: 'notification-1',
    entity_type: 'team',
    entity_id: 'team-1',
    sender_id: null,
    created_at: '2026-11-13T09:00:00Z',
    notification_event_type: 'computer_setup',
    state: 'unseen',
    notification_metadata: {
      tag: 'computer_setup',
      content: {
        computerId: 'computer-1',
        harnessId: outcome.kind === 'ready' ? 'harness-1' : null,
        computerName: "Maya's Agent Box",
        outcome,
      },
    },
  }) as unknown as UnifiedNotification;

afterEach(() => {
  const request = computerSetupRequest();
  if (request) consumeComputerSetupRequest(request.id);
});

it('says the computer is ready and what to do next', () => {
  const ready = notice({ kind: 'ready' });
  expect(getNotificationAction(ready)).toBe('is ready');
  expect(getNotificationContent(ready)).toBe(
    'Connect your AI and finish setup, then create an agent on it.'
  );
});

it('says why setup failed and where to retry', () => {
  const failed = notice({
    kind: 'failed',
    failureReason: 'The host ran out of disk.',
  });
  expect(getNotificationAction(failed)).toBe('could not be set up');
  expect(getNotificationContent(failed)).toBe(
    'The host ran out of disk. Retry from the setup flow.'
  );
});

it.each([
  { kind: 'ready' as const },
  { kind: 'failed' as const, failureReason: 'The host ran out of disk.' },
])(
  'opens Settings → Machines on the computer’s setup ($kind)',
  async (outcome) => {
    const openWithSplit = vi.fn(() => ({ status: 'opened' as const }));
    const layout = { openWithSplit } as unknown as SplitManager;

    const result = await openNotification(notice(outcome), layout);

    expect(result.isOk()).toBe(true);
    expect(computerSetupRequest()).toMatchObject({ computerId: 'computer-1' });
    expect(openWithSplit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'component', id: 'settings' }),
      expect.anything()
    );
  }
);
