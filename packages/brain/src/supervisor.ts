// Trusted Node supervisor. Persona OS identity and systemd provide isolation.
import { spawn } from 'node:child_process';
import * as nodeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abortableSleep } from './events.ts';
import { initTelemetry, shutdownTelemetry, withSpan } from './telemetry.ts';
import { relayTelemetry } from './telemetry-relay.ts';
import { type Git, gitCli } from './workspace.ts';

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIRING = [
  'brain.ts',
  ':(glob)brain/**/*.ts',
  'brain.lock',
  'config/jev.json',
  'config/events.json',
  'config/budget.json',
];
const ENV = [
  'PATH',
  'HOME',
  'LANG',
  'TZ',
  'MACRO_GATEWAY',
  'BRAIN_WORKSPACE',
  'BRAIN_HEALTH_PORT',
  'ANTHROPIC_BASE_URL',
  'MACRO_REPO_URL',
  'BRAIN_EXECUTABLE',
  'BRAIN_PROVISION_TRACEPARENT',
  'BRAIN_TELEMETRY',
  'MACRO_AGENT_USER_ID',
  'MACRO_TEAM_ID',
  'MACRO_COMPUTER_ID',
];
export type Installation = { root: string; config: string; version: string };

/** Resolve an exact installed version; never download library code or npm dependencies. */
export async function installation(workspace: string): Promise<Installation> {
  const version = (
    await nodeFs.readFile(join(workspace, 'brain.lock'), 'utf8')
  ).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('brain.lock must contain an exact library version');
  const root = process.env.BRAIN_LIBRARY_ROOT
    ? join(process.env.BRAIN_LIBRARY_ROOT, version)
    : PACKAGE;
  const config = join(root, 'package.json');
  const manifest = JSON.parse(await nodeFs.readFile(config, 'utf8'));
  if (manifest.version !== version || manifest.name !== '@macro-inc/brain')
    throw new Error(`library ${version} is not installed`);
  return { root, config, version };
}

async function configuration(
  workspace: string,
  installed: Installation
): Promise<string> {
  const directory = join(workspace, 'node_modules', '@macro-inc');
  await nodeFs.mkdir(directory, { recursive: true });
  const link = join(directory, 'brain');
  try {
    if ((await nodeFs.readlink(link)) !== installed.root) {
      await nodeFs.unlink(link);
      await nodeFs.symlink(installed.root, link, 'dir');
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
    await nodeFs.symlink(installed.root, link, 'dir');
  }
  const path = join(workspace, 'cache', 'brain-tsconfig.json');
  await nodeFs.mkdir(dirname(path), { recursive: true });
  await nodeFs.mkdir(join(workspace, 'brain'), { recursive: true });
  await nodeFs.writeFile(
    path,
    JSON.stringify({
      extends: join(installed.root, 'tsconfig.json'),
      include: ['../brain.ts', '../brain/**/*.ts'],
      exclude: ['../node_modules'],
      compilerOptions: {
        noEmit: true,
        typeRoots: [join(installed.root, 'node_modules', '@types')],
      },
    })
  );
  return path;
}

/** A cleared environment: credentials enter library adapters through bootstrap stdin. */
export function childEnvironment(
  workspace: string,
  check: boolean
): Record<string, string> {
  const env: Record<string, string> = { BRAIN_WORKSPACE: workspace };
  for (const name of ENV) {
    if (
      name === 'BRAIN_WORKSPACE' ||
      (check && !['PATH', 'HOME', 'LANG', 'TZ'].includes(name))
    )
      continue;
    const value = process.env[name];
    if (value) env[name] = value;
  }
  if (!check && process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
    env.BRAIN_TELEMETRY = '1';
  return env;
}

async function runCheck(workspace: string, args: string[]): Promise<void> {
  const child = spawn(process.execPath, args, {
    cwd: workspace,
    env: childEnvironment(workspace, true),
    stdio: 'inherit',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`brain check failed: ${args[0]}`))
    );
  });
}

/** Trusted typecheck and fake boot run independently of the workspace's own tests. */
export async function checkWorkspace(
  workspace: string,
  regressionRoot = workspace
): Promise<void> {
  await withSpan('brain.wiring.check', {}, async () => {
    const installed = await installation(workspace);
    const config = await configuration(workspace, installed);
    await runCheck(workspace, [
      join(installed.root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit',
      '--project',
      config,
    ]);
    const tests: string[] = [];
    for await (const file of nodeFs.glob(
      ['brain/**/*.test.ts', 'brain/**/*_test.ts'],
      { cwd: workspace }
    ))
      tests.push(file);
    if (tests.length)
      await runCheck(workspace, ['--test', '--test-timeout=60000', ...tests]);
    const boot = await nodeFs.mkdtemp(join(tmpdir(), 'brain-check-'));
    const excluded = new Set([
      '.git',
      'node_modules',
      'cache',
      'history',
      'log',
      'work',
    ]);
    try {
      await nodeFs.cp(workspace, boot, {
        recursive: true,
        filter: (path) => {
          const first = relative(workspace, path).split(sep)[0];
          const name = basename(path);
          return (
            !excluded.has(first) &&
            name !== 'secrets' &&
            !name.startsWith('secrets.') &&
            !name.endsWith('.secret')
          );
        },
      });
      await configuration(boot, installed);
      await runCheck(boot, [
        join(installed.root, 'src/host.ts'),
        'check',
        join(boot, 'brain.ts'),
        boot,
        regressionRoot,
      ]);
    } finally {
      await nodeFs.rm(boot, { recursive: true, force: true });
    }
  });
}

async function launch(snapshot: string, workspace: string): Promise<Running> {
  const installed = await installation(snapshot);
  await configuration(snapshot, installed);
  const child = spawn(
    process.execPath,
    [
      join(installed.root, 'src/host.ts'),
      'run',
      join(snapshot, 'brain.ts'),
      workspace,
    ],
    {
      cwd: workspace,
      env: childEnvironment(workspace, false),
      stdio: ['pipe', 'pipe', 'inherit', 'ipc'],
    }
  );
  const ready = Promise.withResolvers<void>();
  child.on('message', (message) => {
    if (message === 'ready') ready.resolve();
  });
  let exited = false;
  const status = new Promise<void>((resolve) => {
    child.on('error', () => {
      exited = true;
      resolve();
    });
    child.on('close', () => {
      exited = true;
      resolve();
    });
  });
  if (!child.stdin || !child.stdout) throw new Error('missing child pipes');
  child.stdin.on('error', () => {});
  child.stdin.end(
    JSON.stringify(
      Object.fromEntries(
        ['MACRO_API_KEY', 'MACRO_REPO_TOKEN', 'ANTHROPIC_AUTH_TOKEN'].map(
          (name) => [name, process.env[name]]
        )
      )
    )
  );
  const relayed = relayTelemetry(
    child.stdout,
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  ).catch(() => console.error(JSON.stringify({ telemetry: 'relay_failed' })));
  const port = Number(process.env.BRAIN_HEALTH_PORT);
  try {
    await Promise.race([
      ready.promise,
      status.then(() => {
        throw new Error('brain exited before intake ready');
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error('intake readiness timed out')),
          30000
        );
        timer.unref();
        ready.promise.then(
          () => clearTimeout(timer),
          () => clearTimeout(timer)
        );
      }),
    ]);
  } catch (error) {
    child.kill('SIGTERM');
    // A process stuck in preparation cannot drain a turn it has not started.
    child.kill('SIGKILL');
    await status;
    throw error;
  }
  return {
    async activate() {
      child.send('activate');
    },
    exited: () => exited,
    async stop() {
      if (!exited) child.kill('SIGTERM');
      await status;
      await relayed;
    },
    async healthy() {
      if (exited) return false;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        return response.ok && (await response.json()).status === 'ok';
      } catch {
        return false;
      }
    },
  };
}
export type Running = {
  activate(): Promise<void>;
  stop(): Promise<void>;
  healthy(): Promise<boolean>;
  exited(): boolean;
};
export type SupervisorDeps = {
  head(): Promise<string>;
  snapshot(commit: string): Promise<string>;
  check(snapshot: string): Promise<void>;
  launch(snapshot: string): Promise<Running>;
  reject(commit: string, good: string, reason: string): Promise<void>;
  save(good: string): Promise<void>;
  now(): number;
  probationMs: number;
};
/** Check, prepare overlapping intake, drain the old generation, activate, then promote. */
export class Supervisor {
  private readonly deps: SupervisorDeps;
  private good;
  private running?: Running;
  private active = '';
  private since = 0;
  private healthySince: number | undefined;
  private readonly rejected = new Set<string>();
  constructor(deps: SupervisorDeps, good = '') {
    this.deps = deps;
    this.good = good;
  }
  async tick(): Promise<void> {
    const commit = await this.deps.head();
    if (
      commit !== this.active &&
      !this.rejected.has(commit) &&
      (!this.running || this.good !== '')
    ) {
      const snapshot = await this.deps.snapshot(commit);
      try {
        await this.deps.check(snapshot);
      } catch {
        await this.rollback(commit, 'check failed');
        return;
      }
      let next: Running;
      try {
        next = await this.deps.launch(snapshot);
      } catch {
        await this.rollback(commit, 'boot failed');
        return;
      }
      // New intake is already connected and buffering: stopping the old intake
      // cannot create a gap, and only one generation owns workspace queues.
      await this.running?.stop();
      this.running = next;
      this.active = commit;
      this.since = this.deps.now();
      this.healthySince = undefined;
      await next.activate();
    }
    if (!this.running) return;
    const healthy = await this.running.healthy();
    if (healthy) {
      this.healthySince ??= this.deps.now();
      if (
        this.deps.now() - this.healthySince >= this.deps.probationMs &&
        this.good !== this.active
      ) {
        await this.deps.save(this.active);
        this.good = this.active;
      }
    } else {
      this.healthySince = undefined;
      if (
        this.running.exited() ||
        this.deps.now() - this.since >= this.deps.probationMs
      ) {
        await this.rollback(this.active, 'health failed');
      }
    }
  }
  private async rollback(commit: string, reason: string): Promise<void> {
    this.rejected.add(commit);
    if (!this.good)
      throw new Error(`initial brain ${reason}; no last-known-good commit`);
    // A failed check or preparation never interrupts the healthy generation.
    const keepRunning =
      commit !== this.active &&
      this.active === this.good &&
      this.running &&
      !this.running.exited();
    const replacement = keepRunning
      ? undefined
      : await this.deps.launch(await this.deps.snapshot(this.good));
    if (replacement) await this.running?.stop();
    try {
      await this.deps.reject(commit, this.good, reason);
    } catch (error) {
      console.error(JSON.stringify({ rewiring_revert_failed: String(error) }));
    }
    if (replacement) {
      this.running = replacement;
      this.active = this.good;
      await replacement.activate();
      this.since = this.deps.now();
      this.healthySince = undefined;
    }
  }
  async stop(): Promise<void> {
    await this.running?.stop();
  }
}
async function must(git: Git, args: string[]): Promise<string> {
  const result = await git(args);
  if (result.code !== 0)
    throw new Error(`supervisor git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
export async function workspaceSupervisor(
  workspace: string,
  start: (snapshot: string, workspace: string) => Promise<Running> = launch
): Promise<Supervisor> {
  const git = gitCli(workspace);
  const cache = join(workspace, 'cache', 'wiring');
  await nodeFs.mkdir(cache, { recursive: true });
  const state = join(cache, 'last-good');
  let good = '';
  try {
    good = (await nodeFs.readFile(state, 'utf8')).trim();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const minutes = Number(process.env['BRAIN_HEALTH_MINUTES'] ?? '5');
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error('BRAIN_HEALTH_MINUTES must be positive');
  const supervisor = new Supervisor(
    {
      head: async () => {
        if ((await must(git, ['branch', '--show-current'])) !== 'main')
          throw new Error('brain activates only a main checkout');
        return must(git, [
          'log',
          '-1',
          '--format=%H',
          'refs/heads/main',
          '--',
          ...WIRING,
        ]);
      },
      snapshot: async (commit) => {
        const path = join(cache, commit);
        try {
          await nodeFs.stat(join(path, '.git'));
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              'code' in error &&
              error.code === 'ENOENT'
            )
          )
            throw error;
          await must(git, ['worktree', 'add', '--detach', path, commit]);
        }
        return path;
      },
      check: (snapshot) => checkWorkspace(snapshot, workspace),
      launch: (snapshot) => start(snapshot, workspace),
      reject: async (commit, lastGood, reason) => {
        await withSpan(
          'brain.wiring.revert',
          { 'brain.wiring.reason': reason },
          async () => {
            const note = `Wiring ${commit} rejected: ${reason}. Restored ${lastGood}.`;
            const path = join(
              workspace,
              'memory',
              'notes',
              'brain-rewiring.md'
            );
            await nodeFs.mkdir(dirname(path), { recursive: true });
            await nodeFs.writeFile(path, `${note}\n`, { flag: 'a' });
            await nodeFs.writeFile(
              join(workspace, 'cache', 'rewiring-notice'),
              note
            );
            // Preserve unrelated newer commits and uncommitted edits; restore code only.
            if (
              (await must(git, [
                'log',
                '-1',
                '--format=%H',
                'refs/heads/main',
                '--',
                ...WIRING,
              ])) !== commit
            )
              return;
            if (await must(git, ['status', '--porcelain', '--', ...WIRING]))
              throw new Error('cannot revert wiring with uncommitted edits');
            const paths = (
              await must(git, [
                'diff',
                '--name-only',
                lastGood,
                commit,
                '--',
                ...WIRING,
              ])
            )
              .split('\n')
              .filter(Boolean);
            if (paths.length) {
              await must(git, [
                'restore',
                `--source=${lastGood}`,
                '--staged',
                '--worktree',
                '--',
                ...paths,
              ]);
              await must(git, ['add', '--', 'memory/notes/brain-rewiring.md']);
              await must(git, [
                '-c',
                'commit.gpgsign=false',
                'commit',
                '-m',
                'fix(brain): restore healthy wiring',
                '--',
                ...paths,
                'memory/notes/brain-rewiring.md',
              ]);
            }
          }
        );
      },
      save: async (commit) => {
        await nodeFs.writeFile(`${state}.tmp`, commit);
        await nodeFs.rename(`${state}.tmp`, state);
      },
      now: Date.now,
      probationMs: minutes * 60000,
    },
    good
  );
  return supervisor;
}
export async function supervise(): Promise<void> {
  await initTelemetry((name) => process.env[name]);
  const supervisor = await workspaceSupervisor(
    resolve(process.env['BRAIN_WORKSPACE'] ?? '')
  );
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => stop.abort());
  try {
    while (!stop.signal.aborted) {
      await supervisor.tick();
      await abortableSleep(2000, stop.signal).catch((error) => {
        if (!stop.signal.aborted) throw error;
      });
    }
  } finally {
    await supervisor.stop();
    await shutdownTelemetry();
  }
}
