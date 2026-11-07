import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTyping } from './presence.ts';

test('typing starts at once and stop sends "stop" exactly once', async () => {
  const sent: boolean[] = [];
  const stop = startTyping(
    async (active) => {
      sent.push(active);
    },
    { log: () => {} }
  );
  await Promise.all([stop(), stop()]);
  assert.deepEqual(sent, [true, false]);
});
