import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { Lanes } from './lanes.ts';

test('messages that arrive during a turn become one batch for the next turn', async () => {
  const dir = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-lanes-')
  );
  const batches: string[][] = [];
  const firstTurn = Promise.withResolvers<void>();
  const firstStarted = Promise.withResolvers<void>();
  const lanes = new Lanes<{
    text: string;
  }>(
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
  assert.deepEqual(batches, [['hello'], ['are you there?', 'hello??']]);
  assert.deepEqual(await lanes.pending('channel-1'), []);
});
test('a batch interrupted by a crash runs again first on resume', async () => {
  const dir = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-lanes-')
  );
  await nodeFs.writeFile(
    `${dir}/channel-1.batch`,
    '{"text":"before the crash"}\n'
  );
  await nodeFs.writeFile(`${dir}/channel-1.jsonl`, '{"text":"after"}\n');
  const batches: string[][] = [];
  const lanes = new Lanes<{
    text: string;
  }>(
    dir,
    async (_lane, batch) => {
      batches.push(batch.map((item) => item.text));
    },
    () => {}
  );
  const resumed = await lanes.resume();
  await lanes.settled();
  assert.deepEqual(resumed, 1);
  assert.deepEqual(batches, [['before the crash'], ['after']]);
});
test('a failed batch moves to failed/ and the lane keeps going', async () => {
  const dir = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-lanes-')
  );
  const logged: object[] = [];
  const lanes = new Lanes<{
    text: string;
  }>(
    dir,
    async (_lane, batch) => {
      if (batch[0]?.text === 'boom') throw new Error('turn failed');
    },
    (line) => logged.push(line)
  );
  await lanes.push('channel-1', { text: 'boom' });
  await lanes.settled();
  const failed = await Array.fromAsync(
    await nodeFs.readdir(`${dir}/failed`, { withFileTypes: true })
  );
  assert.deepEqual(failed.length, 1);
  assert.deepEqual(
    await nodeFs.readFile(`${dir}/failed/${failed[0]?.name}`, 'utf8'),
    '{"text":"boom"}\n'
  );
  assert.deepEqual(logged, [
    { lane: 'channel-1', items: 1, batch_failed: 'Error: turn failed' },
  ]);
});
