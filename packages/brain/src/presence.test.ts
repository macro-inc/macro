import { assertEquals } from '@std/assert';
import { startTyping } from './presence.ts';

Deno.test('typing starts at once and stop sends "stop" exactly once', async () => {
  const sent: boolean[] = [];
  const stop = startTyping(
    async (active) => {
      sent.push(active);
    },
    { log: () => {} }
  );

  await Promise.all([stop(), stop()]);

  assertEquals(sent, [true, false]);
});
