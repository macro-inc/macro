import {
  CacheHostDisposedError,
  CacheHostFailedError,
  CacheRequestTimeoutError,
} from '@graphql-cache/host/errors';
import { CacheNavigationError } from '@graphql-cache/host/navigation-error';
import { CoordinatorRestartedError } from '@graphql-cache/host/worker-host';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CACHE_OFF_LIMIT_MS,
  CacheNotRestartedError,
  CacheRecoverySupersededError,
  createCacheRecovery,
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

const hostFailed = () => new CacheHostFailedError(new Error('Failed to fetch'));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('retries a failed host on reconnect, single flight, until storage is readable', async () => {
  const opened = Promise.withResolvers<void>();
  const rebuild = vi.fn(() => opened.promise);
  const recovery = createCacheRecovery(rebuild);
  recovery.failed(hostFailed());
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

it('allows another foreground attempt after repeated host failures', async () => {
  const rebuild = vi.fn(async (): Promise<void> => {
    throw hostFailed();
  });
  const recovery = createCacheRecovery(rebuild);
  recovery.failed(hostFailed());
  await vi.advanceTimersByTimeAsync(120_000);
  expect(rebuild.mock.calls.length).toBeGreaterThan(5);
  expect(recovery.state()).toBe('unavailable');
  rebuild.mockResolvedValueOnce(undefined);
  await recovery.retry();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});

it('does not reopen after a failure it does not know', async () => {
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
  const failure = hostFailed();
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
  recovery.failed(new CoordinatorRestartedError());
  expect(recovery.state()).toBe('unavailable');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(rebuild).toHaveBeenCalledOnce();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});

it('retries after startup went unanswered', async () => {
  const rebuild = vi.fn(async () => {});
  const recovery = createCacheRecovery(rebuild);
  recovery.failed(new CacheRequestTimeoutError('init'));
  expect(recovery.state()).toBe('unavailable');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(rebuild).toHaveBeenCalledOnce();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});

it.each([
  [
    'its owner was lost',
    Object.assign(new Error('owner epoch 2 was lost'), {
      errorCode: 'owner-epoch-lost',
    }),
  ],
  ['the page was suspended', new CacheNavigationError()],
  ['its read timed out', new CacheRequestTimeoutError('current-revision')],
  ['its host was disposed', new CacheHostDisposedError()],
  ['the page replaced its host', new CacheRecoverySupersededError()],
  ['it ended without a host', new CacheNotRestartedError()],
])('keeps retrying a restart cut short because %s', async (_why, error) => {
  const rebuild = vi.fn(async (): Promise<void> => {
    throw error;
  });
  const onStopped = vi.fn();
  const recovery = createCacheRecovery(rebuild, { onStopped });
  recovery.failed(hostFailed());
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  expect(rebuild.mock.calls.length).toBeGreaterThan(20);
  expect(recovery.state()).toBe('unavailable');
  expect(onStopped).not.toHaveBeenCalled();
  rebuild.mockResolvedValueOnce(undefined);
  await recovery.retry();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});

it.each([
  ['retries', hostFailed()],
  ['stops', new Error('database recovery failed')],
])(
  '%s as the host that failed during a restart says, whatever the restart rejects with',
  async (outcome, reported) => {
    let restart = Promise.withResolvers<void>();
    const rebuild = vi.fn(() => restart.promise);
    const onStopped = vi.fn();
    const recovery = createCacheRecovery(rebuild, { onStopped });
    recovery.failed(hostFailed());
    const first = expect(recovery.retry()).rejects.toThrow('consequence');
    recovery.failed(reported);
    // Its own retry finds the restart still running.
    await vi.advanceTimersByTimeAsync(60_000);
    restart.reject(
      outcome === 'stops'
        ? Object.assign(new Error('consequence'), {
            errorCode: 'owner-epoch-lost',
          })
        : new Error('consequence')
    );
    await first;
    expect(rebuild).toHaveBeenCalledOnce();
    restart = Promise.withResolvers<void>();
    restart.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    const retries = outcome === 'retries';
    expect(recovery.state()).toBe(retries ? 'ready' : 'recovery-required');
    expect(rebuild).toHaveBeenCalledTimes(retries ? 2 : 1);
    expect(onStopped).toHaveBeenCalledTimes(retries ? 0 : 1);
    recovery.reset();
  }
);

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

it('keeps restarting a cache that fails soon after each successful restart, at a capped rate', async () => {
  const rebuild = vi.fn(async () => {});
  const onRelapse = vi.fn();
  const onStopped = vi.fn();
  const recovery = createCacheRecovery(rebuild, { onRelapse, onStopped });
  recovery.failed(hostFailed());
  for (let restart = 1; restart <= 30; restart += 1) {
    await vi.advanceTimersByTimeAsync(40_000);
    expect(rebuild).toHaveBeenCalledTimes(restart);
    expect(recovery.state()).toBe('ready');
    // The restarted host fails again before it stayed up.
    recovery.failed(hostFailed());
  }
  expect(onRelapse).toHaveBeenCalledTimes(30);
  expect(onStopped).not.toHaveBeenCalled();
  // The backoff did not start over.
  await vi.advanceTimersByTimeAsync(20_000);
  expect(rebuild).toHaveBeenCalledTimes(30);
  recovery.reset();
});

it('tells once when the cache stays off while the page is visible, and goes on', async () => {
  const rebuild = vi.fn(async (): Promise<void> => {
    throw hostFailed();
  });
  const onOffPastLimit = vi.fn();
  const recovery = createCacheRecovery(rebuild, { onOffPastLimit });
  recovery.failed(hostFailed());
  await vi.advanceTimersByTimeAsync(CACHE_OFF_LIMIT_MS - 1);
  expect(onOffPastLimit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10 * CACHE_OFF_LIMIT_MS);
  expect(onOffPastLimit).toHaveBeenCalledExactlyOnceWith(
    expect.any(Number),
    hostFailed()
  );
  const made = rebuild.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(rebuild.mock.calls.length).toBeGreaterThan(made);

  rebuild.mockResolvedValueOnce(undefined);
  await recovery.retry();
  expect(recovery.state()).toBe('ready');
  await vi.advanceTimersByTimeAsync(10 * CACHE_OFF_LIMIT_MS);
  expect(onOffPastLimit).toHaveBeenCalledOnce();
  recovery.reset();
});

it('proves a host that serves again at once, also offline and hidden', async () => {
  const rebuild = vi.fn(async () => {});
  const recovery = createCacheRecovery(rebuild);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  recovery.failed(
    Object.assign(new Error('another context holds the database'), {
      errorCode: 'owner-lock-unavailable',
    })
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(rebuild).not.toHaveBeenCalled();

  await recovery.available();

  expect(rebuild).toHaveBeenCalledOnce();
  expect(recovery.state()).toBe('ready');
  await recovery.available();
  expect(rebuild).toHaveBeenCalledOnce();
  recovery.reset();
});

it('proves a host again that served again during an attempt which then failed', async () => {
  const first = Promise.withResolvers<void>();
  const rebuild = vi.fn(() => first.promise);
  const recovery = createCacheRecovery(rebuild);
  recovery.failed(hostFailed());
  const retry = expect(recovery.retry()).rejects.toThrow('Failed to fetch');
  const available = recovery.available();
  rebuild.mockResolvedValueOnce(undefined);
  first.reject(hostFailed());
  await retry;
  await available;
  expect(rebuild).toHaveBeenCalledTimes(2);
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});

it('counts failures afresh once a restarted cache stayed up', async () => {
  const rebuild = vi.fn(async () => {});
  const onRelapse = vi.fn();
  const recovery = createCacheRecovery(rebuild, { onRelapse });
  const blocked = hostFailed();
  for (let round = 0; round < 20; round += 1) {
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
  expect(rebuild.mock.calls.length).toBeGreaterThan(20);
  expect(recovery.state()).toBe('unavailable');
  expect(onStopped).not.toHaveBeenCalled();
  rebuild.mockResolvedValueOnce(undefined);
  await recovery.retry();
  expect(recovery.state()).toBe('ready');
  recovery.reset();
});
