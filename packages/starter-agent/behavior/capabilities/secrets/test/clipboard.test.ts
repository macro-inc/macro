// The X clipboard: served by a child that holds the value, never in its arguments, for one paste or 20 seconds.
import { expect, test } from 'bun:test';
import type { RunOptions, Started } from '../../../context/shell.ts';
import { fixedClock } from '../../../context/test/fakes.ts';
import { xClipboard } from '../clipboard.ts';

type Spawned = {
  readonly argv: readonly string[];
  readonly options: RunOptions & { readonly detached?: boolean };
};

const fake = (exit?: number, read = { code: 0, stdout: 'from-a-page' }) => {
  const started: Spawned[] = [];
  const ran: Spawned[] = [];
  const shell = {
    start: (argv: readonly string[], options = {}): Started => {
      started.push({ argv, options });
      return {
        pid: 1,
        exited:
          exit === undefined
            ? new Promise<number>(() => {})
            : Promise.resolve(exit),
        kill: () => undefined,
      };
    },
    run: async (argv: readonly string[], options: RunOptions = {}) => {
      ran.push({ argv, options });
      return { ...read, stderr: '' };
    },
    alive: () => true,
  };
  const clipboard = xClipboard({
    shell,
    clock: fixedClock('2026-11-11T12:00:00Z'),
  });
  return { started, ran, clipboard };
};

test('a copy is served from stdin by a detached xclip that lasts 20 seconds or one paste', async () => {
  const { started, clipboard } = fake();
  await clipboard.put('the-value-0123456789');
  expect(started).toEqual([
    {
      argv: [
        'timeout',
        '20',
        'xclip',
        '-selection',
        'clipboard',
        '-loops',
        '1',
        '-quiet',
      ],
      options: { stdin: 'the-value-0123456789', detached: true },
    },
  ]);
  expect(JSON.stringify(started[0]?.argv)).not.toContain('the-value');
});

test("a server that dies at once is a failure that doesn't name the value", async () => {
  const { clipboard } = fake(127);
  const error = await clipboard.put('the-value-0123456789').then(
    () => 'no error',
    (thrown: unknown) =>
      thrown instanceof Error ? thrown.message : String(thrown)
  );
  expect(error).toBe(
    "couldn't put it on the clipboard: xclip exited 127 (is xclip installed, and DISPLAY set?)"
  );
});

test('reading takes the clipboard as it is, and an empty one is refused', async () => {
  expect(await fake().clipboard.take()).toBe('from-a-page');
  const { ran } = fake();
  expect(ran).toEqual([]);
  const empty = fake(undefined, { code: 1, stdout: '' });
  await expect(empty.clipboard.take()).rejects.toThrow(
    'the clipboard is empty'
  );
  expect(empty.ran[0]?.argv).toEqual([
    'xclip',
    '-selection',
    'clipboard',
    '-o',
  ]);
});
