import { expect, it, vi } from 'vitest';
import {
  beginCacheWriteSession,
  captureCacheWriteSession,
  endCacheWriteSession,
} from './session-writes';

it('keeps handles captured during a wipe stale and serializes a later login', async () => {
  await beginCacheWriteSession(async () => {}).ready;
  const previous = captureCacheWriteSession();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const clearing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const ending = endCacheWriteSession(async () => {
    started();
    await gate;
  });
  const during = captureCacheWriteSession();
  const next = beginCacheWriteSession(async () => {});
  await clearing;
  expect(previous.isCurrent()).toBe(false);
  expect(next.isCurrent()).toBe(false);
  release();
  await Promise.all([ending, next.ready]);
  expect(next.isCurrent()).toBe(true);
  expect(during.isCurrent()).toBe(false);
});

it('keeps failed clearing closed without poisoning a later login', async () => {
  await beginCacheWriteSession(async () => {}).ready;
  await expect(
    endCacheWriteSession(async () => {
      throw new Error('wipe failed');
    })
  ).rejects.toThrow('wipe failed');
  expect(captureCacheWriteSession().isCurrent()).toBe(false);
  const next = beginCacheWriteSession(async () => {});
  await next.ready;
  expect(next.isCurrent()).toBe(true);
});

it('starts sign-out immediately but keeps a rejected callback behind the pending write drain', async () => {
  await beginCacheWriteSession(async () => {}).ready;
  const started = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const signout = Promise.withResolvers<void>();
  const writing = captureCacheWriteSession().run(async () => {
    started.resolve();
    await held.promise;
  });
  await started.promise;
  const ending = endCacheWriteSession(async () => {
    signout.resolve();
    throw new Error('Independent cleanup failed');
  });
  const rejected = expect(ending).rejects.toThrow('Independent cleanup failed');
  await signout.promise;
  const cleanup = vi.fn(async () => {});
  const next = beginCacheWriteSession(cleanup);
  expect(next.isCurrent()).toBe(false);
  expect(cleanup).not.toHaveBeenCalled();
  held.resolve();
  await Promise.all([writing, rejected, next.ready]);
  expect(cleanup).toHaveBeenCalledOnce();
  expect(next.isCurrent()).toBe(true);
});
