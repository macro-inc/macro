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
  installation,
  type Running,
  Supervisor,
} from './supervisor.ts';
import { useTestLibrary } from './test-library.ts';

useTestLibrary();

test('library resolution refuses missing or blank BRAIN_LIBRARY_ROOT', async () => {
  const previous = process.env.BRAIN_LIBRARY_ROOT;
  try {
    for (const value of [undefined, '', '  ']) {
      if (value === undefined) delete process.env.BRAIN_LIBRARY_ROOT;
      else process.env.BRAIN_LIBRARY_ROOT = value;
      await assert.rejects(
        () => installation('/unused-workspace'),
        /BRAIN_LIBRARY_ROOT/
      );
    }
  } finally {
    if (previous === undefined) delete process.env.BRAIN_LIBRARY_ROOT;
    else process.env.BRAIN_LIBRARY_ROOT = previous;
  }
});

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

test('an unhealthy but live last-good generation is restarted with overlapping intake', async () => {
  let starts = 0;
  let stops = 0;
  let healthy = true;
  let now = 0;
  const supervisor = new Supervisor({
    head: async () => 'good',
    snapshot: async (commit) => commit,
    check: async () => {},
    launch: async () => {
      starts++;
      return {
        activate: async () => {},
        healthy: async () => healthy,
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
  healthy = false;
  now = 2;
  await supervisor.tick();
  assert.equal(starts, 2);
  assert.equal(stops, 1);
  await supervisor.stop();
});

test('supervisor fake boot refuses broken turn hooks instead of accepting a swallowed lane failure', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-hook-conformance-')
  );
  try {
    await nodeFs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await assert.rejects(
      () =>
        dryRun(
          (deps) =>
            new Brain(deps, {
              beforeTurn() {
                throw new Error('bad turn preparation');
              },
            }),
          root
        ),
      /fake boot handler failed/
    );
    await assert.rejects(
      () =>
        dryRun(
          (deps) =>
            new Brain(deps, {
              afterTurn() {
                throw new Error('bad turn completion');
              },
            }),
          root
        ),
      /fake boot handler failed/
    );
  } finally {
    await nodeFs.rm(root, { recursive: true });
  }
});

test('repeated brain checks leave live queued messages, receipts and memory untouched', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-check-isolation-')
  );
  try {
    await nodeFs.cp(new URL('../template/', import.meta.url), root, {
      recursive: true,
    });
    await nodeFs.appendFile(
      nodePath.join(root, 'brain.ts'),
      `
import { writeFile } from 'node:fs/promises';
await writeFile(new URL('./check-import-marker', import.meta.url), 'fake boot');
`
    );
    await nodeFs.mkdir(nodePath.join(root, 'cache/lanes'), { recursive: true });
    const queued = `${JSON.stringify({ id: 'waiting-user-message', channelId: 'live-channel', channel: 'live', root: 'waiting-user-message', thread: null, dm: true, from: 'sender', at: '2026-11-04T10:00:00Z', text: 'must survive checks', mentionsMe: false })}\n`;
    const receipts = '["real-receipt"]';
    const memory = await nodeFs.readFile(
      nodePath.join(root, 'memory/self.json'),
      'utf8'
    );
    await nodeFs.writeFile(
      nodePath.join(root, 'cache/lanes/live-channel.jsonl'),
      queued
    );
    await nodeFs.writeFile(
      nodePath.join(root, 'cache/event-receipts.json'),
      receipts
    );
    await checkWorkspace(root);
    await checkWorkspace(root);
    assert.equal(
      await nodeFs.readFile(
        nodePath.join(root, 'cache/lanes/live-channel.jsonl'),
        'utf8'
      ),
      queued
    );
    assert.equal(
      await nodeFs.readFile(
        nodePath.join(root, 'cache/event-receipts.json'),
        'utf8'
      ),
      receipts
    );
    assert.equal(
      await nodeFs.readFile(nodePath.join(root, 'memory/self.json'), 'utf8'),
      memory
    );
    await assert.rejects(
      nodeFs.stat(nodePath.join(root, 'check-import-marker'))
    );
    const proposed = await nodeFs.readdir(
      nodePath.join(root, 'brain/fixtures')
    );
    assert.deepEqual(proposed, ['README.md']);
  } finally {
    await nodeFs.rm(root, { recursive: true });
  }
});
