import { CoordinatorRestartsExhaustedError } from '@graphql-cache/host/worker-host';
import { CacheBootstrapExhaustedError } from '@graphql-cache/worker/startup';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createCacheRecovery,
  MAX_RECOVERY_RELAPSES,
  RECOVERY_HEALTHY_MS,
} from './cache-recovery';

vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: async (work: Promise<unknown>) => {
    try {
      await work;
    } catch {
      // Recovery exposes its error state to the caller.
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('retries an untouched bootstrap on reconnect, single flight, until storage is readable', async () => {
  const opened = Promise.withResolvers<void>();
  const rebuild = vi.fn(() => opened.promise);
  const recovery = createCacheRecovery(rebuild);
  recovery.failed(new CacheBootstrapExhaustedError('Failed to fetch'));
  window.dispatchEvent(new Event('online'));
  const retry = recovery.retry();
  expect(recovery.state()).toBe('recovering');
  expect(rebuild).toHaveBeenCalledOnce();
  opened.resolve();
  await retry;
  expect(recovery.state()).toBe('ready');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(rebuild).toHaveBeenCalledOnce();
  recovery.reset();
});

it('allows another foreground attempt after repeated bootstrap failures', async () => {
  const rebuild = vi.fn(async (): Promise<void> => {
    throw new CacheBootstrapExhaustedError('Failed to fetch');
  });
  const recovery = createCacheRecovery(rebuild);
  recovery.failed(new CacheBootstrapExhaustedError('Failed to fetch'));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(rebuild.mock.calls.length).toBeGreaterThan(5);
  expect(recovery.state()).toBe('unavailable');
  rebuild.mockResolvedValueOnce(undefined);
  await recovery.retry();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});

it('does not reopen potentially damaged storage', async () => {
  const rebuild = vi.fn(async () => {});
  const recovery = createCacheRecovery(rebuild);
  const error = new Error('database recovery failed');
  recovery.failed(error);
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(60_000);
  await expect(recovery.retry()).rejects.toBe(error);
  expect(recovery.state()).toBe('recovery-required');
  expect(rebuild).not.toHaveBeenCalled();
  recovery.reset();
});

it('pauses offline and fences a completion from the previous session', async () => {
  const opened = Promise.withResolvers<void>();
  const rebuild = vi.fn(() => opened.promise);
  const recovery = createCacheRecovery(rebuild);
  const failure = new CacheBootstrapExhaustedError('Failed to fetch');
  recovery.failed(failure);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(rebuild).not.toHaveBeenCalled();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const old = recovery.retry();
  recovery.reset();
  recovery.failed(new Error('new account storage requires recovery'));
  opened.resolve();
  await old;
  expect(recovery.state()).toBe('recovery-required');
  recovery.reset();
});

it('retries after a read refused while the database changed owners', async () => {
  const rebuild = vi.fn(async () => {});
  const recovery = createCacheRecovery(rebuild);
  const blocked = Object.assign(
    new Error('cache reads unavailable after owner handoff timeout'),
    { errorCode: 'owner-handoff-blocked' }
  );
  recovery.failed(blocked);
  expect(recovery.state()).toBe('unavailable');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(rebuild).toHaveBeenCalledOnce();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});

it('retries after the coordinator kept restarting before its handshake', async () => {
  const rebuild = vi.fn(async () => {});
  const recovery = createCacheRecovery(rebuild);
  recovery.failed(new CoordinatorRestartsExhaustedError());
  expect(recovery.state()).toBe('unavailable');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(rebuild).toHaveBeenCalledOnce();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});

it('keeps an engine transport failure closed even when it looks like a lost owner', async () => {
  const rebuild = vi.fn(async () => {});
  const recovery = createCacheRecovery(rebuild);
  const lost = Object.assign(
    new Error('cache coordinator transport restarted'),
    {
      errorCode: 'owner-epoch-lost',
    }
  );
  recovery.failed(lost);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(rebuild).not.toHaveBeenCalled();
  expect(recovery.state()).toBe('recovery-required');
  recovery.reset();
});

it('never retries after a newer build took the database over', async () => {
  const rebuild = vi.fn(async () => {});
  const onStopped = vi.fn();
  const recovery = createCacheRecovery(rebuild, { onStopped });
  const superseded = Object.assign(
    new Error('a newer version of the app took over the local cache'),
    { errorCode: 'cache-superseded' }
  );
  recovery.failed(superseded);
  expect(recovery.state()).toBe('recovery-required');
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(rebuild).not.toHaveBeenCalled();
  await expect(recovery.retry()).rejects.toBe(superseded);
  expect(onStopped).toHaveBeenCalledExactlyOnceWith(
    'superseded',
    0,
    superseded
  );
  recovery.reset();
});

it('stops after a cache keeps failing soon after each successful restart', async () => {
  const rebuild = vi.fn(async () => {});
  const onRelapse = vi.fn();
  const onStopped = vi.fn();
  const recovery = createCacheRecovery(rebuild, { onRelapse, onStopped });
  const lockHeld = Object.assign(
    new Error('cache database owner lock is held by another context'),
    { errorCode: 'owner-lock-unavailable' }
  );
  recovery.failed(lockHeld);
  for (let restart = 1; restart <= MAX_RECOVERY_RELAPSES; restart += 1) {
    await vi.advanceTimersByTimeAsync(40_000);
    expect(rebuild).toHaveBeenCalledTimes(restart);
    expect(recovery.state()).toBe('ready');
    // The restarted host fails again before it stayed up.
    recovery.failed(lockHeld);
  }
  expect(onRelapse).toHaveBeenCalledTimes(MAX_RECOVERY_RELAPSES);
  expect(recovery.state()).toBe('recovery-required');
  expect(onStopped).toHaveBeenCalledExactlyOnceWith(
    'relapses-exhausted',
    MAX_RECOVERY_RELAPSES,
    lockHeld
  );
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(rebuild).toHaveBeenCalledTimes(MAX_RECOVERY_RELAPSES);
  recovery.reset();
});

it('counts failures afresh once a restarted cache stayed up', async () => {
  const rebuild = vi.fn(async () => {});
  const onRelapse = vi.fn();
  const recovery = createCacheRecovery(rebuild, { onRelapse });
  const blocked = new CacheBootstrapExhaustedError('Failed to fetch');
  for (let round = 0; round < MAX_RECOVERY_RELAPSES * 2; round += 1) {
    recovery.failed(blocked);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(recovery.state()).toBe('ready');
    expect(recovery.attempts()).toBe(1);
    await vi.advanceTimersByTimeAsync(RECOVERY_HEALTHY_MS);
    expect(recovery.attempts()).toBe(0);
  }
  expect(onRelapse).not.toHaveBeenCalled();
  recovery.reset();
});

it('keeps retrying a lock another context holds for a long time', async () => {
  const lockHeld = Object.assign(
    new Error('cache database owner lock is held by another context'),
    { errorCode: 'owner-lock-unavailable' }
  );
  const rebuild = vi.fn(async (): Promise<void> => {
    throw lockHeld;
  });
  const onStopped = vi.fn();
  const recovery = createCacheRecovery(rebuild, { onStopped });
  recovery.failed(lockHeld);
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  expect(rebuild.mock.calls.length).toBeGreaterThan(MAX_RECOVERY_RELAPSES * 2);
  expect(recovery.state()).toBe('unavailable');
  expect(onStopped).not.toHaveBeenCalled();
  rebuild.mockResolvedValueOnce(undefined);
  await recovery.retry();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});
