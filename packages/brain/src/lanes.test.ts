import { assertEquals } from '@std/assert';
import { Lanes } from './lanes.ts';

Deno.test('messages that arrive during a turn become one batch for the next turn', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'brain-lanes-' });
  const batches: string[][] = [];
  const firstTurn = Promise.withResolvers<void>();
  const firstStarted = Promise.withResolvers<void>();

  const lanes = new Lanes<{ text: string }>(
    dir,
    async (_lane, batch) => {
      batches.push(batch.map((item) => item.text));
      if (batches.length === 1) {
        firstStarted.resolve();
        await firstTurn.promise;
      }
    },
    () => {}
  );

  await lanes.push('channel-1', { text: 'hello' });
  await firstStarted.promise;
  await lanes.push('channel-1', { text: 'are you there?' });
  await lanes.push('channel-1', { text: 'hello??' });
  firstTurn.resolve();
  await lanes.settled();

  assertEquals(batches, [['hello'], ['are you there?', 'hello??']]);
  assertEquals(await lanes.pending('channel-1'), []);
});

Deno.test('a batch interrupted by a crash runs again first on resume', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'brain-lanes-' });
  await Deno.writeTextFile(
    `${dir}/channel-1.batch`,
    '{"text":"before the crash"}\n'
  );
  await Deno.writeTextFile(`${dir}/channel-1.jsonl`, '{"text":"after"}\n');
  const batches: string[][] = [];

  const lanes = new Lanes<{ text: string }>(
    dir,
    async (_lane, batch) => {
      batches.push(batch.map((item) => item.text));
    },
    () => {}
  );
  const resumed = await lanes.resume();
  await lanes.settled();

  assertEquals(resumed, 1);
  assertEquals(batches, [['before the crash'], ['after']]);
});

Deno.test('a failed batch moves to failed/ and the lane keeps going', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'brain-lanes-' });
  const logged: object[] = [];
  const lanes = new Lanes<{ text: string }>(
    dir,
    async (_lane, batch) => {
      if (batch[0]?.text === 'boom') throw new Error('turn failed');
    },
    (line) => logged.push(line)
  );

  await lanes.push('channel-1', { text: 'boom' });
  await lanes.settled();

  const failed = await Array.fromAsync(Deno.readDir(`${dir}/failed`));
  assertEquals(failed.length, 1);
  assertEquals(
    await Deno.readTextFile(`${dir}/failed/${failed[0]?.name}`),
    '{"text":"boom"}\n'
  );
  assertEquals(logged, [
    { lane: 'channel-1', items: 1, batch_failed: 'Error: turn failed' },
  ]);
});
