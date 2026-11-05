import { assertEquals } from '@std/assert';
import { Memory } from './memory.ts';
import { GitWriter, gitCli, Workspace } from './workspace.ts';

async function memoryIn(): Promise<{ memory: Memory; root: string }> {
  const root = await Deno.makeTempDir({ prefix: 'brain-memory-' });
  const workspace = new Workspace(root);
  const memory = new Memory(
    workspace,
    new GitWriter(workspace, gitCli(root)),
    () => new Date('2026-11-04T10:00:00Z')
  );
  return { memory, root };
}

Deno.test('remember appends dated lines to a topic note; recall finds them; forget removes the note', async () => {
  const { memory, root } = await memoryIn();

  await memory.remember('Bo Lee', 'prefers invoices as PDF');
  await memory.remember('Bo Lee', 'out until the 12th');
  await memory.remember('vendors', 'Acme bills on the 1st');

  assertEquals(
    await Deno.readTextFile(`${root}/memory/notes/bo-lee.md`),
    '# Bo Lee\n\n- 2026-11-04: prefers invoices as PDF\n- 2026-11-04: out until the 12th\n'
  );
  assertEquals(await memory.recall('bo pdf'), [
    { topic: 'bo-lee', lines: ['- 2026-11-04: prefers invoices as PDF'] },
  ]);

  await memory.forget('Bo Lee');
  assertEquals(await memory.recall('bo'), []);
});

Deno.test('concurrent self-state updates keep every change', async () => {
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

  assertEquals(await memory.self(), {
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

  assertEquals(await memory.release('corrected invoice'), 1);
  assertEquals((await memory.self()).commitments, []);
});
