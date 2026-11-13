import { readPendingEmailSends } from '@service-storage/email-send';
import type { PendingEmailSendsQuery } from '@service-storage/graphql/generated/graphql';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readEmailSendIntents, watchEmailSends } from './send-queue';
import {
  refreshServerEmailSends,
  serverEmailSends,
  serverSendAccount,
  setServerSendSession,
} from './server-sends';

vi.mock('@service-storage/email-send', () => ({
  readPendingEmailSends: vi.fn(),
}));
vi.mock('./send-queue', () => ({
  readEmailSendIntents: vi.fn(),
  watchEmailSends: vi.fn(),
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

const nothingPending: PendingEmailSendsQuery['user'] = {
  id: 'owner',
  pendingEmailSends: { nextCursor: null, attempts: [] },
};
const withStatus = (
  status: PendingEmailSendsQuery['user']['pendingEmailSends']['attempts'][number]['attempt']['status'],
  sendTime: string | null = null
): PendingEmailSendsQuery['user'] => ({
  id: 'owner',
  pendingEmailSends: {
    nextCursor: null,
    attempts: [
      {
        linkId: 'inbox',
        attempt: {
          ...pending.pendingEmailSends.attempts[0].attempt,
          status,
          sendTime,
        },
      },
    ],
  },
});

let journalChanged: () => void = () => {};
let visibility: DocumentVisibilityState = 'visible';
const show = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
};
const reads = () => vi.mocked(readPendingEmailSends).mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility
  );
  vi.mocked(readPendingEmailSends).mockReset().mockResolvedValue(pending);
  vi.mocked(readEmailSendIntents).mockReset().mockResolvedValue([]);
  vi.mocked(watchEmailSends)
    .mockReset()
    .mockImplementation((changed) => {
      journalChanged = changed;
      return () => {};
    });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  setServerSendSession(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('loads sends from other devices on sign-in without a local send or rollout flag', async () => {
  setServerSendSession('owner');
  await vi.waitFor(() =>
    expect(serverEmailSends()).toEqual(pending.pendingEmailSends.attempts)
  );
  expect(readPendingEmailSends).toHaveBeenCalledTimes(1);
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

it('answers a refresh made during a read with a read that started after it', async () => {
  const first = Promise.withResolvers<PendingEmailSendsQuery['user']>();
  vi.mocked(readPendingEmailSends)
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValueOnce({
      ...pending,
      pendingEmailSends: { nextCursor: null, attempts: [] },
    });
  setServerSendSession('owner');
  const refresh = refreshServerEmailSends();
  first.resolve(pending);
  await refresh;
  expect(readPendingEmailSends).toHaveBeenCalledTimes(2);
  expect(serverEmailSends()).toEqual([]);
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

it('reads once a minute while visible with nothing in motion', async () => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(10_000);
  const settled = reads();
  await vi.advanceTimersByTimeAsync(49_000);
  expect(reads()).toBe(settled);
  await vi.advanceTimersByTimeAsync(11_000);
  expect(reads()).toBe(settled + 1);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(reads()).toBe(settled + 11);
});

it.each([
  ['a failed send', withStatus('FAILED')],
  ['an unconfirmed send', withStatus('DELIVERY_UNCONFIRMED')],
  [
    'a send scheduled for tomorrow',
    withStatus('ACCEPTED', new Date(Date.now() + 86_400_000).toISOString()),
  ],
])('keeps the idle pace for %s', async (_, response) => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(response);
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(10_000);
  const settled = reads();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reads()).toBe(settled + 1);
});

it.each([
  ['accepted', withStatus('ACCEPTED')],
  ['sending', withStatus('SENDING')],
  [
    'due within the minute',
    withStatus('ACCEPTED', new Date(Date.now() + 30_000).toISOString()),
  ],
])('reads every ten seconds while a send is %s', async (_, response) => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(response);
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(10_000);
  const started = reads();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reads()).toBe(started + 6);
});

it('returns to the idle pace once the send is gone', async () => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(withStatus('SENDING'));
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(30_000);
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  await vi.advanceTimersByTimeAsync(10_000);
  const settled = reads();
  expect(serverEmailSends()).toEqual([]);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(reads()).toBe(settled);
});

it('reads at once and keeps the fast pace while this browser has a queued send', async () => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(10_000);
  const idle = reads();
  vi.mocked(readEmailSendIntents).mockResolvedValue([
    {} as Awaited<ReturnType<typeof readEmailSendIntents>>[number],
  ]);
  journalChanged();
  await vi.advanceTimersByTimeAsync(0);
  expect(reads()).toBe(idle + 1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reads()).toBe(idle + 4);
  vi.mocked(readEmailSendIntents).mockResolvedValue([]);
  journalChanged();
  await vi.advanceTimersByTimeAsync(0);
  const retired = reads();
  expect(retired).toBe(idle + 5);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(reads()).toBe(retired);
});

it('does not read when only drafts change in the journal', async () => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(10_000);
  const idle = reads();
  journalChanged();
  journalChanged();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(reads()).toBe(idle);
});

it('stops reading while hidden, even with a send in motion, and reads when shown', async () => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(withStatus('SENDING'));
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(10_000);
  show('hidden');
  const hidden = reads();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(reads()).toBe(hidden);
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  show('visible');
  await vi.advanceTimersByTimeAsync(0);
  expect(reads()).toBe(hidden + 1);
  expect(serverEmailSends()).toEqual([]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reads()).toBe(hidden + 2);
});

it('keeps the fast pace when the journal cannot be read', async () => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  vi.mocked(readEmailSendIntents).mockRejectedValue(new Error('no storage'));
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reads()).toBe(7);
});

it('retries a failed read at the fast pace', async () => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(10_000);
  vi.mocked(readPendingEmailSends).mockRejectedValue(new Error('offline'));
  await vi.advanceTimersByTimeAsync(60_000);
  const failed = reads();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads()).toBe(failed + 1);
});

it('re-arms after a read that was in flight while the tab was hidden and shown', async () => {
  const slow = Promise.withResolvers<PendingEmailSendsQuery['user']>();
  vi.mocked(readPendingEmailSends).mockImplementationOnce(() => slow.promise);
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(0);
  show('hidden');
  show('visible');
  slow.resolve(nothingPending);
  await vi.advanceTimersByTimeAsync(0);
  const shown = reads();
  await vi.advanceTimersByTimeAsync(70_000);
  expect(reads()).toBeGreaterThan(shown);
});

it('picks up the fast pace when a scheduled send comes due', async () => {
  const due = Date.now() + 150_000;
  vi.mocked(readPendingEmailSends).mockResolvedValue(
    withStatus('ACCEPTED', new Date(due).toISOString())
  );
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(100_000);
  const idle = reads();
  expect(idle).toBeLessThanOrEqual(3);
  await vi.advanceTimersByTimeAsync(50_000);
  expect(reads()).toBeGreaterThanOrEqual(idle + 3);
});

it('retries an unreadable journal and settles once it reads', async () => {
  vi.mocked(readPendingEmailSends).mockResolvedValue(nothingPending);
  vi.mocked(readEmailSendIntents).mockRejectedValueOnce(new Error('busy'));
  setServerSendSession('owner');
  await vi.advanceTimersByTimeAsync(10_000);
  const settled = reads();
  await vi.advanceTimersByTimeAsync(59_000);
  expect(reads()).toBeLessThanOrEqual(settled + 1);
});
