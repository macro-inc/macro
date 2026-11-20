import { expect, test } from 'bun:test';
import type { Ran } from '../../../context/shell.ts';
import { fixedClock, memoryDisk } from '../../../context/test/fakes.ts';
import { markHealthy, restartExitCode, restarter } from '../restart.ts';

const restartFile = '/home/agent/.restart';
const lastGood = '/home/agent/state/last-good';

test('a restart touches the supervisor’s marker, then exits 75', async () => {
  const disk = memoryDisk();
  const seen: string[] = [];
  const restart = restarter({
    disk: {
      write: async (path, text) => {
        seen.push(`write ${path}`);
        await disk.write(path, text);
      },
    },
    file: restartFile,
    clock: fixedClock('2026-11-09T15:00:00Z'),
    exit: (code) => {
      seen.push(`exit ${code}`);
    },
  });
  await restart();
  expect(restartExitCode).toBe(75);
  expect(seen).toEqual([`write ${restartFile}`, 'exit 75']);
  expect(disk.files.get(restartFile)).toBe('2026-11-09T15:00:00Z\n');
});

test('a healthy boot writes the HEAD it booted from as the last good', async () => {
  const disk = memoryDisk();
  const sha = 'a'.repeat(40);
  const asked: string[] = [];
  const git = async (args: readonly string[]): Promise<Ran> => {
    asked.push(args.join(' '));
    return { code: 0, stdout: `${sha}\n`, stderr: '' };
  };
  expect(await markHealthy({ git, disk, file: lastGood })).toBe(sha);
  expect(asked).toEqual(['rev-parse --verify HEAD']);
  expect(disk.files.get(lastGood)).toBe(`${sha}\n`);
});

test('no HEAD to read: nothing is written, and it says why', async () => {
  const disk = memoryDisk();
  const git = async (): Promise<Ran> => ({
    code: 128,
    stdout: '',
    stderr: 'fatal: not a git repository',
  });
  await expect(markHealthy({ git, disk, file: lastGood })).rejects.toThrow(
    'not a git repository'
  );
  expect(disk.files.has(lastGood)).toBe(false);
});
