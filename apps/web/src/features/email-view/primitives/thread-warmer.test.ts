import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createThreadWarmer } from './thread-warmer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deferredWarm() {
  const pending = new Map<string, (cached: boolean) => void>();
  const fail = new Map<string, (error: Error) => void>();
  const warm = vi.fn(
    (threadId: string) =>
      new Promise<boolean>((resolve, reject) => {
        pending.set(threadId, resolve);
        fail.set(threadId, reject);
      })
  );
  const settle = async (
    threadId: string,
    outcome: true | false | Error = true
  ) => {
    if (outcome instanceof Error) fail.get(threadId)?.(outcome);
    else pending.get(threadId)?.(outcome);
    // The queue settles items and starts the next on timers and microtasks.
    await vi.runAllTimersAsync();
  };
  return { warm, settle };
}

it('warms each thread once and drops requests the cursor has moved past', async () => {
  const { warm, settle } = deferredWarm();
  const warmer = createThreadWarmer({ warm });

  warmer.warm(['a', 'b', 'c']);
  await vi.runAllTimersAsync();
  expect(warm.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
  // The cursor moved on before `c` started: only the new neighbourhood loads.
  warmer.warm(['d']);
  await settle('a');
  await settle('b');
  expect(warm.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'd']);

  warmer.warm(['a', 'd']);
  await vi.runAllTimersAsync();
  await settle('d');
  expect(warm).toHaveBeenCalledTimes(3);
  warmer.dispose();
});

it.each([
  ['failed', new Error('offline')],
  // urql resolves a failed request instead of rejecting it.
  ['left the thread uncached', false],
] as const)('retries a thread whose warm %s', async (_case, outcome) => {
  const { warm, settle } = deferredWarm();
  const warmer = createThreadWarmer({ warm });

  warmer.warm(['a']);
  await vi.runAllTimersAsync();
  await settle('a', outcome);
  warmer.warm(['a']);
  await vi.runAllTimersAsync();
  expect(warm).toHaveBeenCalledTimes(2);
  warmer.dispose();
});
