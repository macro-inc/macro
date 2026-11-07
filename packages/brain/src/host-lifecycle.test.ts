import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { type TestContext, test } from 'node:test';
import {
  hostHealthReply,
  hostHealthy,
  killHostGroup,
  stopHost,
  trackHostExit,
} from './host-lifecycle.ts';
import { type Running, Supervisor } from './supervisor.ts';

test('a stuck old generation is force-stopped before buffered replacement activation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let head = 'old';
  let now = 0;
  const exited = Promise.withResolvers<void>();
  const draining = Promise.withResolvers<void>();
  const steps: string[] = [];
  const supervisor = new Supervisor({
    head: async () => head,
    snapshot: async (revision) => revision,
    check: async () => {},
    launch: async (revision): Promise<Running> => {
      steps.push(`${revision}:buffering`);
      return {
        activate: async () => {
          steps.push(`${revision}:active`);
        },
        healthy: async () => true,
        exited: () => false,
        stop: () =>
          revision === 'old'
            ? stopHost({
                terminate() {
                  steps.push('old:draining');
                  draining.resolve();
                },
                forceStop() {
                  steps.push('old:force-stop');
                },
                exited: exited.promise,
              })
            : Promise.resolve(),
      };
    },
    reject: async () => {
      throw new Error('unexpected rollback');
    },
    save: async () => {},
    now: () => now,
    probationMs: 1,
  });
  await supervisor.tick();
  now = 1;
  await supervisor.tick();
  head = 'next';
  const replacing = supervisor.tick();
  await draining.promise;
  try {
    assert.equal(steps.includes('next:buffering'), true);
    assert.equal(steps.includes('next:active'), false);
    t.mock.timers.tick(29_999);
    assert.equal(steps.includes('old:force-stop'), false);
    t.mock.timers.tick(1);
    assert.equal(steps.includes('old:force-stop'), true);
    assert.equal(steps.includes('next:active'), false);
    steps.push('old:exited');
    exited.resolve();
    await replacing;
    assert.ok(steps.indexOf('old:exited') < steps.indexOf('next:active'));
  } finally {
    exited.resolve();
    await replacing;
    await supervisor.stop();
  }
});

async function fixture(t: TestContext, body: string) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', body], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      killHostGroup(child.pid);
      await closed;
    }
  });
  await once(child, 'message');
  return child;
}

test('health belongs to the exact child and request, ignoring another request reply', async (t) => {
  const child = await fixture(
    t,
    `
    process.on('message', (m) => {
      process.send({ type: 'brain.health.result', requestId: 'foreign-request', healthy: true });
      process.send({ type: 'brain.health.result', requestId: m.requestId, healthy: false });
    });
    process.send('ready');
  `
  );
  assert.equal(await hostHealthy(child), false);
  assert.equal(child.listenerCount('message'), 0);
});

test('prepared hosts cannot report active health before activation', async () => {
  let queried = false;
  const request = { type: 'brain.health', requestId: 'request-1' };
  const health = async () => {
    queried = true;
    return { status: 'ok' };
  };
  assert.deepEqual(await hostHealthReply(request, false, health), {
    type: 'brain.health.result',
    requestId: 'request-1',
    healthy: false,
  });
  assert.equal(queried, false);
  assert.equal((await hostHealthReply(request, true, health))?.healthy, true);
});

test('health requests settle and remove listeners when their child exits', async (t) => {
  const child = await fixture(
    t,
    `process.on('message', () => process.exit(0)); process.send('ready');`
  );
  assert.equal(await hostHealthy(child), false);
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('health IPC has a bounded timeout and clears the pending request', async (t) => {
  const child = await fixture(
    t,
    `process.on('message', () => process.send('received')); process.send('ready');`
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const acknowledged = once(child, 'message');
  const healthy = hostHealthy(child);
  await acknowledged;
  t.mock.timers.tick(2000);
  assert.equal(await healthy, false);
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('force-stop is scoped to the old host group and leaves the replacement alive', async (t) => {
  const old = await fixture(
    t,
    `process.on('SIGTERM', () => process.send('draining')); process.on('message', () => {}); process.send('ready');`
  );
  const next = await fixture(
    t,
    `process.on('message', (m) => process.send({ type: 'brain.health.result', requestId: m.requestId, healthy: true })); process.send('ready');`
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const draining = once(old, 'message');
  const closed = once(old, 'close').then(() => {});
  const stopped = stopHost({
    terminate: () => {
      old.kill('SIGTERM');
    },
    forceStop: () => killHostGroup(old.pid),
    exited: closed,
  });
  await draining;
  t.mock.timers.tick(30_000);
  await stopped;
  assert.equal(old.signalCode, 'SIGKILL');
  assert.equal(await hostHealthy(next), true);
});

test('host exit is observed even when telemetry leaves stdout unread', async () => {
  const child = spawn(
    process.execPath,
    ['-e', 'process.stdout.write(Buffer.alloc(1024 * 1024)); process.exit(0);'],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  );
  const tracked = trackHostExit(child);
  let closed = false;
  child.once('close', () => {
    closed = true;
  });
  try {
    await once(child, 'exit');
    assert.equal(closed, false, 'stdout is intentionally not drained');
    assert.equal(
      tracked.exited(),
      true,
      'ownership follows process exit, not pipe closure'
    );
    await tracked.done;
  } finally {
    child.stdout?.destroy();
    await tracked.done;
  }
});

test('an IPC error on a living host is not mistaken for actual exit', async (t) => {
  const child = await fixture(
    t,
    `process.on('message', () => {}); process.send('ready');`
  );
  const tracked = trackHostExit(child);
  child.emit('error', new Error('fixture IPC error'));
  assert.equal(tracked.exited(), false);
  killHostGroup(child.pid);
  await tracked.done;
  assert.equal(tracked.exited(), true);
});

test('a spawn failure settles exit tracking without an existing process group', async () => {
  const child = spawn('/missing-brain-test-executable', [], {
    stdio: 'ignore',
  });
  const tracked = trackHostExit(child);
  await tracked.done;
  assert.equal(tracked.exited(), true);
});

test('a graceful exit clears its force-stop deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let forced = 0;
  await stopHost({
    terminate() {},
    forceStop() {
      forced++;
    },
    exited: Promise.resolve(),
  });
  t.mock.timers.tick(30_000);
  assert.equal(forced, 0);
});
