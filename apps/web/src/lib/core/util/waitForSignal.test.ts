import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitForSignal } from './waitForSignal';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('resolves with the first value that satisfies the condition', async () => {
  const [count, setCount] = createSignal(0);
  const result = waitForSignal(count, (value) => value >= 2);
  setCount(1);
  setCount(2);
  expect((await result)._unsafeUnwrap()).toBe(2);
});

it('settles with a timeout error instead of rejecting', async () => {
  const [ready] = createSignal(false);
  const result = waitForSignal(ready, Boolean, 300);
  await vi.advanceTimersByTimeAsync(300);
  expect((await result)._unsafeUnwrapErr()).toEqual({ kind: 'timeout' });
});

it('stops tracking the signal once settled', async () => {
  const [count, setCount] = createSignal(0);
  const condition = vi.fn((value: number) => value === 1);
  const result = waitForSignal(count, condition);
  setCount(1);
  await result;
  setCount(2);
  expect(condition).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
