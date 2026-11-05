import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Attempt, rejoinDelay, retry, TOKEN_RETRY } from './retry.ts';

const fast = {
  attempts: 4,
  timeoutMs: 50,
  backoffMs: [1, 1, 1],
  sleep: async () => {},
};
test('call recorded failure regression: a hung token request times out per attempt and the retry gets the token', async () => {
  let n = 0;
  const attempts: Attempt[] = [];
  const t0 = performance.now();
  const r = await retry(
    async () => {
      if (++n === 1) return new Promise<string>(() => {}); // hangs forever, like the 46 s connect
      return 'token';
    },
    { ...fast, onAttempt: (a) => attempts.push(a) }
  );
  assert.strictEqual(r, 'token');
  assert.deepStrictEqual(
    attempts.map((a) => !!a.error),
    [true, false]
  );
  assert(attempts[0]!.error.includes('timed out'));
  assert(performance.now() - t0 < 500);
});
test('ConnectionRefused is retried with backoff, then the last error is thrown', async () => {
  const slept: number[] = [];
  const attempts: Attempt[] = [];
  const err = await retry(
    async () => {
      throw new Error('join channel: undefined {"code":"ConnectionRefused"}');
    },
    {
      ...TOKEN_RETRY,
      timeoutMs: 50,
      sleep: async (ms) => void slept.push(ms),
      onAttempt: (a) => attempts.push(a),
    }
  ).catch((e) => e);
  assert(String(err).includes('ConnectionRefused'));
  assert.strictEqual(attempts.length, 4);
  assert.deepStrictEqual(slept, [250, 750, 1500]);
});
test('the token retry budget fails within about 10 s in the worst case', () => {
  const worst =
    TOKEN_RETRY.attempts * TOKEN_RETRY.timeoutMs +
    TOKEN_RETRY.backoffMs.reduce((a, b) => a + b, 0);
  assert(worst <= 11000);
});
test('the watcher retries a failed join quickly, backing off to 8 s', () => {
  assert.deepStrictEqual(
    [1, 2, 3, 4, 5, 9].map(rejoinDelay),
    [1000, 2000, 4000, 8000, 8000, 8000]
  );
});
