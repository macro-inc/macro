import { expect, test } from 'bun:test';
import { backoffMs, pushed, startBackoff } from '../stream.ts';

test('a stream whose start fails (Macro unreachable) starts again, backing off, and then reads', async () => {
  const waited: number[] = [];
  const reported: string[] = [];
  let attempts = 0;
  const stream = pushed<string>(
    async (emit) => {
      attempts += 1;
      if (attempts < 3) throw new Error('Unable to connect');
      emit('first');
    },
    {
      wait: async (ms) => {
        waited.push(ms);
      },
      report: (error, delayMs) => {
        reported.push(`${String(error)} ${delayMs}`);
      },
    }
  );
  const next = await stream[Symbol.asyncIterator]().next();
  expect(next).toEqual({ done: false, value: 'first' });
  expect(attempts).toBe(3);
  expect(waited).toEqual([startBackoff.firstMs, startBackoff.firstMs * 2]);
  expect(reported).toEqual([
    `Error: Unable to connect ${startBackoff.firstMs}`,
    `Error: Unable to connect ${startBackoff.firstMs * 2}`,
  ]);
});

test('the backoff doubles up to its ceiling', () => {
  expect(backoffMs(1)).toBe(startBackoff.firstMs);
  expect(backoffMs(2)).toBe(startBackoff.firstMs * 2);
  expect(backoffMs(40)).toBe(startBackoff.maxMs);
});
