import { CacheBootstrapExhaustedError } from '@graphql-cache/worker/startup';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCacheRecovery } from './cache-recovery';

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
