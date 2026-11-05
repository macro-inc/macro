import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { Brain } from './brain.ts';
import { dryRun } from './dry-run.ts';
import { runCommand } from './subprocess.ts';
import {
  checkWorkspace,
  childEnvironment,
  type Running,
  Supervisor,
} from './supervisor.ts';

test('template composition typechecks, tests and boots a fake event offline', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-composition-')
  );
  try {
    const template = new URL('../template/', import.meta.url).pathname;
    const copy = await runCommand('cp', {
      args: ['-r', `${template}.`, root],
      clearEnv: true,
      env: { PATH: process.env['PATH'] ?? '' },
    });
    assert.deepEqual(copy.code, 0);
    await checkWorkspace(root);
    await nodeFs.writeFile(
      `${root}/brain.ts`,
      'export default () => { throw new Error("broken composition"); };\n'
    );
    await assert.rejects(() => checkWorkspace(root));
  } finally {
    await nodeFs.rm(root, { recursive: true });
  }
});
test('reload waits for in-flight turns before replacing a healthy composition', async () => {
  let head = 'first';
  let now = 0;
  let finish: () => void = () => {};
  const turn = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const started: string[] = [];
  let stopping: () => void = () => {};
  const draining = new Promise<void>((resolve) => {
    stopping = resolve;
  });
  const supervisor = new Supervisor({
    head: async () => head,
    snapshot: async (commit) => commit,
    check: async () => {},
    launch: async (snapshot): Promise<Running> => {
      started.push(snapshot);
      return {
        activate: async () => {},
        healthy: async () => true,
        exited: () => false,
        stop: async () => {
          stopping();
          await turn;
        },
      };
    },
    reject: () => {
      throw new Error('unexpected rollback');
    },
    save: async () => {},
    now: () => now,
    probationMs: 10,
  });
  await supervisor.tick();
  now = 10;
  await supervisor.tick();
  head = 'second';
  const reload = supervisor.tick();
  await draining;
  assert.deepEqual(started, ['first', 'second']);
  finish();
  await reload;
  assert.deepEqual(started, ['first', 'second']);
  await supervisor.stop();
});
test('broken checks and unhealthy boots revert to persisted last-known-good', async () => {
  let head = 'broken';
  let now = 0;
  const started: string[] = [];
  const rejected: string[] = [];
  const supervisor = new Supervisor(
    {
      head: async () => head,
      snapshot: async (commit) => commit,
      check: async (snapshot) => {
        if (snapshot === 'broken') throw new Error('syntax');
      },
      launch: async (snapshot) => {
        started.push(snapshot);
        return {
          stop: async () => {},
          activate: async () => {},
          healthy: async () => snapshot === 'good',
          exited: () => false,
        };
      },
      reject: async (commit, good, reason) => {
        rejected.push(`${commit}:${good}:${reason}`);
      },
      save: async () => {},
      now: () => now,
      probationMs: 10,
    },
    'good'
  );
  await supervisor.tick();
  assert.deepEqual(started, ['good']);
  assert.deepEqual(rejected, ['broken:good:check failed']);
  head = 'unhealthy';
  await supervisor.tick();
  now = 10;
  await supervisor.tick();
  assert.deepEqual(started, ['good', 'unhealthy', 'good']);
  assert.deepEqual(rejected.at(-1), 'unhealthy:good:health failed');
  await supervisor.stop();
});
test('Node children receive a cleared environment without service credentials', async () => {
  const previous = process.env.UNRELATED_SERVICE_SECRET;
  process.env.UNRELATED_SERVICE_SECRET = 'private';
  try {
    const output = await runCommand(process.execPath, {
      args: [
        '--input-type=module',
        '-e',
        'console.log(JSON.stringify(process.env))',
      ],
      clearEnv: true,
      env: childEnvironment('/tmp/workspace', false),
    });
    assert.equal(output.code, 0);
    const env = JSON.parse(new TextDecoder().decode(output.stdout));
    assert.equal(env.UNRELATED_SERVICE_SECRET, undefined);
    assert.equal(env.MACRO_API_KEY, undefined);
    assert.equal(env.MACRO_REPO_TOKEN, undefined);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(env.BRAIN_WORKSPACE, '/tmp/workspace');
  } finally {
    if (previous === undefined) delete process.env.UNRELATED_SERVICE_SECRET;
    else process.env.UNRELATED_SERVICE_SECRET = previous;
  }
});

test('call adapters dispatch typed lifecycle events to the composition hook', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-call-hook-')
  );
  try {
    const copied = await runCommand('cp', {
      args: [
        '-r',
        `${new URL('../template/', import.meta.url).pathname}.`,
        root,
      ],
      clearEnv: true,
      env: { PATH: process.env['PATH'] ?? '' },
    });
    assert.deepEqual(copied.code, 0);
    const phases: string[] = [];
    await dryRun(async (deps) => {
      const brain = new Brain(deps, {
        onCall: async (call, runtime) => {
          phases.push(call.phase);
          await runtime.remember('calls', call.id);
        },
      });
      await brain.onCall({ id: 'call-test', phase: 'incoming', metadata: {} });
      return brain;
    }, root);
    assert.deepEqual(phases, ['incoming']);
  } finally {
    await nodeFs.rm(root, { recursive: true });
  }
});

test('supervisor conformance rejects a broken health contract independently of own tests', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-conformance-')
  );
  try {
    await nodeFs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await assert.rejects(
      () =>
        dryRun((deps) => {
          const brain = new Brain(deps);
          return {
            checkFixture: (fixture) => brain.checkFixture(fixture),
            prepare: (signal) => brain.prepare(signal),
            run: (signal) => brain.run(signal),
            post: (turn, channel, text) => brain.post(turn, channel, text),
            health: async () => ({
              ...(await brain.health()),
              connected: false,
            }),
          };
        }, root),
      /health contract/
    );
  } finally {
    await nodeFs.rm(root, { recursive: true });
  }
});

test('a rejected proposal leaves the healthy generation listening without a restart', async () => {
  let head = 'good';
  let stops = 0;
  let starts = 0;
  let now = 0;
  const supervisor = new Supervisor({
    head: async () => head,
    snapshot: async (commit) => commit,
    check: async (snapshot) => {
      if (snapshot === 'bad') throw new Error('broken');
    },
    launch: async () => {
      starts++;
      return {
        activate: async () => {},
        healthy: async () => true,
        exited: () => false,
        stop: async () => {
          stops++;
        },
      };
    },
    reject: async () => {},
    save: async () => {},
    now: () => now,
    probationMs: 1,
  });
  await supervisor.tick();
  now = 1;
  await supervisor.tick();
  head = 'bad';
  await supervisor.tick();
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  await supervisor.stop();
});
