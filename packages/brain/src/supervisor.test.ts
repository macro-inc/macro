import { assertEquals, assertRejects } from '@std/assert';
import { Brain } from './brain.ts';
import { dryRun } from './dry-run.ts';
import {
  checkWorkspace,
  permissions,
  type Running,
  Supervisor,
} from './supervisor.ts';

Deno.test('template composition typechecks, tests and boots a fake event offline', async () => {
  const root = await Deno.makeTempDir({ prefix: 'brain-composition-' });
  try {
    const template = new URL('../template/', import.meta.url).pathname;
    const copy = await new Deno.Command('cp', {
      args: ['-r', `${template}.`, root],
      clearEnv: true,
      env: { PATH: Deno.env.get('PATH') ?? '' },
    }).output();
    assertEquals(copy.code, 0);
    await checkWorkspace(root);
    await Deno.writeTextFile(
      `${root}/brain.ts`,
      'export default () => { throw new Error("broken composition"); };\n'
    );
    await assertRejects(() => checkWorkspace(root));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('reload waits for in-flight turns before replacing a healthy composition', async () => {
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
  assertEquals(started, ['first']);
  finish();
  await reload;
  assertEquals(started, ['first', 'second']);
  await supervisor.stop();
});

Deno.test('broken checks and unhealthy boots revert to persisted last-known-good', async () => {
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
  assertEquals(started, ['good']);
  assertEquals(rejected, ['broken:good:check failed']);
  head = 'unhealthy';
  await supervisor.tick();
  now = 10;
  await supervisor.tick();
  assertEquals(started, ['good', 'unhealthy', 'good']);
  assertEquals(rejected.at(-1), 'unhealthy:good:health failed');
  await supervisor.stop();
});

Deno.test('sandbox denies out-of-scope filesystem, network and environment', async () => {
  const root = await Deno.makeTempDir();
  try {
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        ...permissions(
          root,
          'https://gateway.invalid',
          'https://proxy.invalid',
          32123
        ),
        '--no-config',
        '-',
      ],
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
      clearEnv: true,
      env: { PATH: Deno.env.get('PATH') ?? '' },
    }).spawn();
    const writer = result.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(`
      let denied = 0;
      for (const action of [
        () => Deno.readTextFile('/etc/passwd'),
        () => Deno.writeTextFile('/var/brain-forbidden', 'bad'),
        () => fetch('https://example.com'),
        () => new Deno.Command(Deno.execPath(), { args: ['--version'] }).output(),
      ]) {
        try { await action(); } catch (error) {
          if (error instanceof Deno.errors.NotCapable) denied++; else throw error;
        }
      }
      if (Deno.env.get('UNRELATED_SERVICE_SECRET') !== undefined) throw new Error('ambient secret leaked');
      if (denied !== 4) throw new Error('sandbox allowed an out-of-scope operation');
    `)
    );
    await writer.close();
    const output = await result.output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('call adapters dispatch typed lifecycle events to the composition hook', async () => {
  const root = await Deno.makeTempDir({ prefix: 'brain-call-hook-' });
  try {
    const copied = await new Deno.Command('cp', {
      args: [
        '-r',
        `${new URL('../template/', import.meta.url).pathname}.`,
        root,
      ],
      clearEnv: true,
      env: { PATH: Deno.env.get('PATH') ?? '' },
    }).output();
    assertEquals(copied.code, 0);
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
    assertEquals(phases, ['incoming']);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
