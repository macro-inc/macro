import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { Memory } from './memory.ts';
import { GitWriter, gitCli, Workspace } from './workspace.ts';

async function memoryIn(): Promise<{
  memory: Memory;
  root: string;
}> {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-memory-')
  );
  const workspace = new Workspace(root);
  const memory = new Memory(
    workspace,
    new GitWriter(workspace, gitCli(root)),
    () => new Date('2026-11-04T10:00:00Z')
  );
  return { memory, root };
}
test('remember appends dated lines to a topic note; recall finds them; forget removes the note', async () => {
  const { memory, root } = await memoryIn();
  await memory.remember('Bo Lee', 'prefers invoices as PDF');
  await memory.remember('Bo Lee', 'out until the 12th');
  await memory.remember('vendors', 'Acme bills on the 1st');
  assert.deepEqual(
    await nodeFs.readFile(`${root}/memory/notes/bo-lee.md`, 'utf8'),
    '# Bo Lee\n\n- 2026-11-04: prefers invoices as PDF\n- 2026-11-04: out until the 12th\n'
  );
  assert.deepEqual(await memory.recall('bo pdf'), [
    { topic: 'bo-lee', lines: ['- 2026-11-04: prefers invoices as PDF'] },
  ]);
  await memory.forget('Bo Lee');
  assert.deepEqual(await memory.recall('bo'), []);
});
test('concurrent self-state updates keep every change', async () => {
  const { memory } = await memoryIn();
  await Promise.all([
    memory.setFocus('closing the March books'),
    memory.commit({
      what: 'send Bo the corrected invoice',
      to: 'macro|bo@example.com',
      conversation: 'channel-1',
    }),
    memory.said('channel-1.root-1', 'on it'),
  ]);
  assert.deepEqual(await memory.self(), {
    focus: 'closing the March books',
    commitments: [
      {
        what: 'send Bo the corrected invoice',
        to: 'macro|bo@example.com',
        conversation: 'channel-1',
        since: '2026-11-04T10:00:00.000Z',
      },
    ],
    lastSaid: {
      'channel-1.root-1': { at: '2026-11-04T10:00:00.000Z', text: 'on it' },
    },
  });
  assert.deepEqual(await memory.release('corrected invoice'), 1);
  assert.deepEqual((await memory.self()).commitments, []);
});
