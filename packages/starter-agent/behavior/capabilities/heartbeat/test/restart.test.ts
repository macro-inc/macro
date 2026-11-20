import { expect, test } from 'bun:test';
import type { Ran } from '../../../context/shell.ts';
import { fixedClock, memoryDisk } from '../../../context/test/fakes.ts';
import { markHealthy, restartExitCode, restarter } from '../restart.ts';

const restartFile = '/home/agent/.restart';
const listening = async () => undefined;
const deadline = () => new Promise<void>(() => undefined);
const never = () => new Promise<void>(() => undefined);
/** Macro answered: a stream that doesn't open is the code's fault. */
const answered = { reached: () => true, reachable: async () => undefined };
/** Macro unreachable: the agent's machine is offline. */
const offline = { reached: () => false, reachable: never };
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
  expect(
    await markHealthy({
      git,
      disk,
      file: lastGood,
      listening,
      deadline,
      ...answered,
    })
  ).toBe(sha);
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
  await expect(
    markHealthy({ git, disk, file: lastGood, listening, deadline, ...answered })
  ).rejects.toThrow('not a git repository');
  expect(disk.files.has(lastGood)).toBe(false);
});

test('a boot whose stream never opens though Macro answers is not healthy, so the launcher can roll it back', async () => {
  const disk = memoryDisk();
  const asked: string[] = [];
  const git = async (args: readonly string[]): Promise<Ran> => {
    asked.push(args.join(' '));
    return { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
  };
  await expect(
    markHealthy({
      git,
      disk,
      file: lastGood,
      listening: never,
      deadline: async () => undefined,
      ...answered,
    })
  ).rejects.toThrow('not listening');
  expect(asked).toEqual([]);
  expect(disk.files.has(lastGood)).toBe(false);
});

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('offline at the start (Macro unreachable) waits past the deadline, and is healthy once it hears', async () => {
  const disk = memoryDisk();
  const sha = 'b'.repeat(40);
  const git = async (): Promise<Ran> => ({
    code: 0,
    stdout: `${sha}\n`,
    stderr: '',
  });
  const heard = deferred();
  let deadlines = 0;
  const healthy = markHealthy({
    git,
    disk,
    file: lastGood,
    listening: () => heard.promise,
    deadline: async () => {
      deadlines += 1;
    },
    ...offline,
  });
  await Bun.sleep(5);
  expect(deadlines).toBe(1);
  expect(disk.files.has(lastGood)).toBe(false);
  heard.resolve();
  expect(await healthy).toBe(sha);
  expect(disk.files.get(lastGood)).toBe(`${sha}\n`);
});

test('back online, a stream that still does not open within a new deadline is a failed boot', async () => {
  const disk = memoryDisk();
  const git = async (): Promise<Ran> => ({
    code: 0,
    stdout: `${'c'.repeat(40)}\n`,
    stderr: '',
  });
  const online = deferred();
  let reached = false;
  const firstDeadline = deferred();
  let deadlines = 0;
  const healthy = markHealthy({
    git,
    disk,
    file: lastGood,
    listening: never,
    deadline: () => {
      deadlines += 1;
      return deadlines === 1 ? firstDeadline.promise : Promise.resolve();
    },
    reached: () => reached,
    reachable: () => online.promise,
  });
  firstDeadline.resolve();
  await Bun.sleep(5);
  expect(deadlines).toBe(1);
  reached = true;
  online.resolve();
  await expect(healthy).rejects.toThrow('not listening');
  expect(deadlines).toBe(2);
  expect(disk.files.has(lastGood)).toBe(false);
});
