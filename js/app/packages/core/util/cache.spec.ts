import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cache } from './cache';
import { err, type MaybeResult, ok } from './maybeResult';

describe('cache', () => {
  let mockFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFn = vi.fn(() => Promise.resolve(ok({ data: 'test' })));
    vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.setSystemTime(new Date());
  });

  test('cache function results', async () => {
    const cachedFn = cache(mockFn, { minutes: 5 });

    await cachedFn('arg1', 'arg2');
    await cachedFn('arg1', 'arg2');

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test('invalidate cache after expiration', async () => {
    const cachedFn = cache(mockFn, { minutes: 1 });

    await cachedFn('arg1', 'arg2');

    vi.setSystemTime(new Date('2023-01-01T00:02:00Z'));

    await cachedFn('arg1', 'arg2');

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  test('not cache error results', async () => {
    mockFn = vi.fn(() => Promise.resolve(err('ERROR', 'Test error')));
    const cachedFn = cache(mockFn, { minutes: 5 });

    await cachedFn('arg1', 'arg2');
    await cachedFn('arg1', 'arg2');

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  test('invalidate cache for specific arguments', async () => {
    const cachedFn = cache(mockFn, { minutes: 5 });

    await cachedFn('arg1', 'arg2');
    cachedFn.invalidate('arg1', 'arg2');
    await cachedFn('arg1', 'arg2');

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  test('handle different argument combinations', async () => {
    const cachedFn = cache(mockFn, { minutes: 5 });

    await cachedFn('arg1', 'arg2');
    await cachedFn('arg1', 'arg3');
    await cachedFn('arg1', 'arg2');

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  test('handle object arguments correctly', async () => {
    const cachedFn = cache(mockFn, { minutes: 5 });

    await cachedFn({ a: 1, b: 2 });
    // Same object with different order of keys
    await cachedFn({ b: 2, a: 1 });

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test('handle promises that resolve after expiration time', async () => {
    const slowMockFn = vi.fn(
      (_arg: string) =>
        new Promise<MaybeResult<string, { data: string }>>((resolve) => {
          setTimeout(() => resolve(ok({ data: 'slow test' })), 100);
        })
    );

    const cachedFn = cache(slowMockFn, { minutes: 1 });

    const promise = cachedFn('slow-arg');

    // Move time forward by 2 minutes (past expiration)
    vi.setSystemTime(new Date('2023-01-01T00:02:00Z'));

    const result = await promise;
    expect(result).toEqual(ok({ data: 'slow test' }));

    await cachedFn('slow-arg');

    expect(slowMockFn).toHaveBeenCalledTimes(2);
  });

  test('cache results just before expiration', async () => {
    const cachedFn = cache(mockFn, { minutes: 5 });

    await cachedFn('arg1', 'arg2');

    vi.setSystemTime(new Date('2023-01-01T00:04:59Z'));

    await cachedFn('arg1', 'arg2');

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test('invalidate cache exactly at expiration', async () => {
    const cachedFn = cache(mockFn, { minutes: 2, seconds: 1 });

    await cachedFn('arg1', 'arg2');

    vi.setSystemTime(new Date('2023-01-01T00:05:01Z'));

    await cachedFn('arg1', 'arg2');

    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});
