import { readPendingEmailSends } from '@service-storage/email-send';
import type { PendingEmailSendsQuery } from '@service-storage/graphql/generated/graphql';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  refreshServerEmailSends,
  serverEmailSends,
  serverSendAccount,
  setServerSendSession,
} from './server-sends';

vi.mock('@service-storage/email-send', () => ({
  readPendingEmailSends: vi.fn(),
}));

const pending: PendingEmailSendsQuery['user'] = {
  id: 'owner',
  pendingEmailSends: {
    nextCursor: null,
    attempts: [
      {
        linkId: 'inbox',
        attempt: {
          attemptId: 'other-device-send',
          status: 'ACCEPTED',
          message: null,
          threadId: 'thread',
          sendTime: null,
        },
      },
    ],
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(readPendingEmailSends).mockReset().mockResolvedValue(pending);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  setServerSendSession(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('loads sends from other devices on sign-in without a local send or rollout flag', async () => {
  setServerSendSession('owner');
  await refreshServerEmailSends();
  expect(readPendingEmailSends).toHaveBeenCalledTimes(1);
  expect(serverEmailSends()).toEqual(pending.pendingEmailSends.attempts);
});

it('waits offline and refreshes server sends on reconnect', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  setServerSendSession('owner');
  await refreshServerEmailSends();
  expect(readPendingEmailSends).not.toHaveBeenCalled();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  await refreshServerEmailSends();
  expect(serverEmailSends()).toEqual(pending.pendingEmailSends.attempts);
});

it('discards an in-flight status response after sign-out', async () => {
  const response = Promise.withResolvers<PendingEmailSendsQuery['user']>();
  const started = Promise.withResolvers<AbortSignal>();
  vi.mocked(readPendingEmailSends).mockImplementationOnce((_, signal) => {
    started.resolve(signal);
    return response.promise;
  });
  setServerSendSession('owner');
  const refresh = refreshServerEmailSends();
  const signal = await started.promise;
  setServerSendSession(undefined);
  expect(signal.aborted).toBe(true);
  response.resolve(pending);
  await refresh;
  expect(serverSendAccount()).toBeUndefined();
  expect(serverEmailSends()).toEqual([]);
});
