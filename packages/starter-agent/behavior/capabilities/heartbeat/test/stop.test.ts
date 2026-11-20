import { expect, test } from 'bun:test';
import type { Agent, Woke } from '@macro-inc/muppet/core/agent';
import type { CommitResult } from '../commit.ts';
import { restartExitCode } from '../restart.ts';
import { counted, stopMessage, stopper, watchMarker } from '../stop.ts';

const wake = {
  request: 'r',
  systemPrompt: 's',
  event: { name: 'e', payload: undefined },
  state: {} as never,
};

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('counted knows how many wakes are running, including ones that fail', async () => {
  const held = deferred<Woke>();
  const inner: Agent = {
    wake: async () => held.promise,
  };
  const { agent, running } = counted(inner);
  expect(running()).toBe(0);
  const first = agent.wake(wake);
  const second = agent.wake(wake);
  expect(running()).toBe(2);
  held.resolve({ kind: 'done', reply: 'ok' });
  await Promise.all([first, second]);
  expect(running()).toBe(0);

  const failing = counted({
    wake: async () => {
      throw new Error('boom');
    },
  });
  await failing.agent.wake(wake).catch(() => undefined);
  expect(failing.running()).toBe(0);
});

const recorder = (running: number, result: Promise<CommitResult>) => {
  const seen: string[] = [];
  const stop = stopper({
    running: () => running,
    commit: async (message) => {
      seen.push(`commit ${message}`);
      return result;
    },
    log: async (entry) => {
      seen.push(`log ${JSON.stringify(entry)}`);
    },
    flush: async () => {
      seen.push('flush');
    },
    exit: (code) => {
      seen.push(`exit ${code}`);
    },
    timeoutMs: 50,
    sleep: (ms) => Bun.sleep(ms),
  });
  return { seen, stop };
};

test('a stop with no wake running syncs once more, then exits 0', async () => {
  const { seen, stop } = recorder(0, Promise.resolve('pushed'));
  await stop();
  expect(seen).toEqual([
    `commit ${stopMessage}`,
    `log ${JSON.stringify({ stop: 'synced', result: 'pushed' })}`,
    'flush',
    'exit 0',
  ]);
});

test('a stop while a wake runs does not sync: the wake is cut off', async () => {
  const { seen, stop } = recorder(1, Promise.resolve('pushed'));
  await stop();
  expect(seen).toEqual([
    `log ${JSON.stringify({ stop: 'not synced', running: 1 })}`,
    'flush',
    'exit 0',
  ]);
});

test('a sync that hangs (the network) does not hold the stop past its timeout', async () => {
  const { seen, stop } = recorder(
    0,
    new Promise<CommitResult>(() => undefined)
  );
  await stop();
  expect(seen).toEqual([
    `commit ${stopMessage}`,
    `log ${JSON.stringify({ stop: 'synced', result: 'timed out' })}`,
    'flush',
    'exit 0',
  ]);
});

test('a sync that throws still exits 0, and a second signal does nothing more', async () => {
  const { seen, stop } = recorder(0, Promise.reject(new Error('git died')));
  await Promise.all([stop(), stop()]);
  expect(seen).toEqual([
    `commit ${stopMessage}`,
    `log ${JSON.stringify({ stop: 'synced', result: 'threw: Error: git died' })}`,
    'flush',
    'exit 0',
  ]);
});

test('a restart (a land touched the marker) stops the same way, then exits 75', async () => {
  const { seen, stop } = recorder(0, Promise.resolve('pushed'));
  await stop(restartExitCode);
  await stop();
  expect(seen).toEqual([
    `commit ${stopMessage}`,
    `log ${JSON.stringify({ stop: 'synced', result: 'pushed' })}`,
    'flush',
    `exit ${restartExitCode}`,
  ]);
});

test('the marker watch fires once, when the marker changes from what it was at the start', async () => {
  const contents = [undefined, undefined, '2026-11-20T20:00:00Z\n', 'later\n'];
  let reads = 0;
  let fired = 0;
  const slept: number[] = [];
  await watchMarker({
    read: async () => contents[Math.min(reads++, contents.length - 1)],
    sleep: async (ms) => {
      slept.push(ms);
    },
    everyMs: 1000,
    changed: () => {
      fired += 1;
    },
  });
  expect(fired).toBe(1);
  expect(reads).toBe(3);
  expect(slept).toEqual([1000, 1000]);
});

test('a marker already there at the start (the last land) is not a restart', async () => {
  const contents = ['old\n', 'old\n', 'new\n'];
  let reads = 0;
  let fired = 0;
  await watchMarker({
    read: async () => contents[Math.min(reads++, contents.length - 1)],
    sleep: async () => undefined,
    everyMs: 1000,
    changed: () => {
      fired += 1;
    },
  });
  expect(fired).toBe(1);
  expect(reads).toBe(3);
});
