// Trusted supervisor. Agent modules run only in a separate permissioned Deno.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abortableSleep } from './events.ts';
import { initTelemetry, shutdownTelemetry, withSpan } from './telemetry.ts';
import { relayTelemetry } from './telemetry-relay.ts';
import { type Git, gitCli } from './workspace.ts';

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIRING = ['brain.ts', 'brain', 'brain.lock'];
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
  'BRAIN_TELEMETRY',
  'MACRO_AGENT_USER_ID',
  'MACRO_TEAM_ID',
  'MACRO_COMPUTER_ID',
  'BRAIN_PROVISION_TRACEPARENT',
];

export type Installation = { root: string; config: string; version: string };

/** Resolve an exact installed version; never resolve ranges or download code. */
export async function installation(workspace: string): Promise<Installation> {
  const version = (
    await Deno.readTextFile(join(workspace, 'brain.lock'))
  ).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('brain.lock must contain an exact library version');
  const root = Deno.env.get('BRAIN_LIBRARY_ROOT')
    ? join(Deno.env.get('BRAIN_LIBRARY_ROOT') ?? '', version)
    : PACKAGE;
  const config = join(root, 'deno.json');
  const manifest = JSON.parse(await Deno.readTextFile(config));
  if (manifest.version !== version)
    throw new Error(`library ${version} is not installed`);
  return { root, config, version };
}

/** Direct Deno capabilities. Permitted executables also need OS isolation. */
export function permissions(
  workspace: string,
  gateway: string,
  anthropic: string,
  port: number,
  check = false
): string[] {
  const net = check
    ? ['127.0.0.1:0']
    : [new URL(gateway).host, new URL(anthropic).host, `127.0.0.1:${port}`];
  return [
    '--no-prompt',
    `--allow-read=${workspace},/tmp`,
    `--allow-write=${workspace},/tmp`,
    '--allow-run=git,claude',
    `--allow-net=${[...new Set(net)].join(',')}`,
    '--allow-env',
    '--allow-sys=homedir,osRelease,hostname,uid,gid',
  ];
}

async function configuration(
  workspace: string,
  installed: Installation
): Promise<string> {
  const manifest = JSON.parse(await Deno.readTextFile(installed.config));
  const imports: Record<string, string> = {};
  for (const [name, target] of Object.entries(manifest.imports)) {
    if (typeof target !== 'string')
      throw new Error('library import must be a string');
    imports[name] = target.startsWith('.')
      ? new URL(target, `file://${installed.config}`).href
      : target;
  }
  imports['@macro-inc/brain'] = new URL(
    './src/mod.ts',
    `file://${installed.config}`
  ).href;
  const path = join(workspace, 'cache', 'brain-imports.json');
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.mkdir(join(workspace, 'brain'), { recursive: true });
  const lock = JSON.parse(
    await Deno.readTextFile(join(installed.root, 'deno.lock'))
  );
  lock.workspace.links = {
    [`jsr:@macro-inc/brain@${installed.version}`]: {
      dependencies: lock.workspace.dependencies,
    },
  };
  const lockPath = join(workspace, 'cache', 'brain-deno.lock');
  await Deno.writeTextFile(lockPath, JSON.stringify(lock));
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      ...manifest,
      name: undefined,
      version: undefined,
      exports: undefined,
      workspace: undefined,
      imports,
      nodeModulesDir: 'auto',
      lock: lockPath,
    })
  );
  return path;
}

function environment(
  workspace: string,
  check: boolean
): Record<string, string> {
  const env: Record<string, string> = {
    BRAIN_WORKSPACE: workspace,
    DENO_NO_UPDATE_CHECK: '1',
  };
  for (const name of ENV) {
    if (
      name === 'BRAIN_WORKSPACE' ||
      (check && !['PATH', 'HOME', 'LANG', 'TZ'].includes(name))
    )
      continue;
    const value = Deno.env.get(name);
    if (value) env[name] = value;
  }
  // The supervisor's dependency cache is image-owned; no inherited user config.
  if (!check && Deno.env.get('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'))
    env.BRAIN_TELEMETRY = '1';
  const cache = Deno.env.get('DENO_DIR');
  if (cache) env.DENO_DIR = cache;
  return env;
}

async function command(
  workspace: string,
  args: string[],
  check: boolean
): Promise<Deno.Command> {
  const installed = await installation(workspace);
  const config = await configuration(workspace, installed);
  return new Deno.Command(Deno.execPath(), {
    args: [
      args[0] ?? 'run',
      '--cached-only',
      '--frozen',
      '--config',
      config,
      ...args.slice(1),
    ],
    cwd: workspace,
    clearEnv: true,
    env: environment(workspace, check),
    stdout: 'inherit',
    stderr: 'inherit',
  });
}

/** Every check runs in the workspace, with no credentials and no remote imports. */
export async function checkWorkspace(workspace: string): Promise<void> {
  await withSpan('brain.wiring.check', {}, async () => {
    const installed = await installation(workspace);
    const sandbox = permissions(
      workspace,
      'https://gateway.invalid',
      'https://gateway.invalid',
      0,
      true
    );
    for (const args of [
      ['check', join(workspace, 'brain.ts')],
      ['test', ...sandbox, '--permit-no-files', 'brain/'],
      [
        'run',
        ...sandbox,
        join(installed.root, 'src/host.ts'),
        'check',
        join(workspace, 'brain.ts'),
        workspace,
      ],
    ]) {
      const child = (await command(workspace, args, true)).spawn();
      const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
      try {
        if (!(await child.status).success)
          throw new Error(`brain check failed at ${args[0]}`);
      } finally {
        clearTimeout(timeout);
      }
    }
  });
}

export type Running = {
  stop(): Promise<void>;
  healthy(): Promise<boolean>;
  exited(): boolean;
};

async function launch(snapshot: string, workspace: string): Promise<Running> {
  const installed = await installation(snapshot);
  const port = Number(Deno.env.get('BRAIN_HEALTH_PORT'));
  const sandbox = permissions(
    workspace,
    Deno.env.get('MACRO_GATEWAY') ?? '',
    Deno.env.get('ANTHROPIC_BASE_URL') ?? '',
    port
  );
  // Snapshot is under workspace/cache, and only its committed code is imported.
  const process = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--cached-only',
      '--frozen',
      '--config',
      await configuration(snapshot, installed),
      ...sandbox,
      join(installed.root, 'src/host.ts'),
      'run',
      join(snapshot, 'brain.ts'),
      workspace,
    ],
    cwd: workspace,
    clearEnv: true,
    env: environment(workspace, false),
    stdout: 'piped',
    stderr: 'inherit',
    stdin: 'piped',
  }).spawn();
  const credentials = Object.fromEntries(
    ['MACRO_API_KEY', 'MACRO_REPO_TOKEN', 'ANTHROPIC_AUTH_TOKEN'].map(
      (name) => [name, Deno.env.get(name)]
    )
  );
  const input = process.stdin.getWriter();
  await input.write(new TextEncoder().encode(JSON.stringify(credentials)));
  await input.close();
  const relayed = relayTelemetry(
    process.stdout,
    Deno.env.get('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT')
  ).catch(() => console.error(JSON.stringify({ telemetry: 'relay_failed' })));
  let exited = false;
  const status = process.status.then((value) => {
    exited = true;
    return value;
  });
  return {
    exited: () => exited,
    async stop() {
      if (!exited) process.kill('SIGTERM');
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

/** Serialized state machine: check first, drain, activate, observe, then promote. */
export class Supervisor {
  private running?: Running;
  private active = '';
  private since = 0;
  private healthySince: number | undefined;
  private readonly rejected = new Set<string>();
  constructor(
    private readonly deps: SupervisorDeps,
    private good = ''
  ) {}

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
      await this.running?.stop();
      this.running = undefined;
      this.active = commit;
      this.since = this.deps.now();
      this.healthySince = undefined;
      try {
        this.running = await this.deps.launch(snapshot);
      } catch {
        await this.rollback(commit, 'boot failed');
        return;
      }
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
    // Rejection records are durable before the replacement process starts.
    await this.running?.stop();
    this.running = undefined;
    await this.deps.reject(commit, this.good, reason);
    this.active = this.good;
    this.running = await this.deps.launch(await this.deps.snapshot(this.good));
    this.since = this.deps.now();
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
  await Deno.mkdir(cache, { recursive: true });
  const state = join(cache, 'last-good');
  let good = '';
  try {
    good = (await Deno.readTextFile(state)).trim();
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const minutes = Number(Deno.env.get('BRAIN_HEALTH_MINUTES') ?? '5');
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
          await Deno.stat(join(path, '.git'));
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
          await must(git, ['worktree', 'add', '--detach', path, commit]);
        }
        return path;
      },
      check: checkWorkspace,
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
            await Deno.mkdir(dirname(path), { recursive: true });
            await Deno.writeTextFile(path, `${note}\n`, { append: true });
            await Deno.writeTextFile(
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
        await Deno.writeTextFile(`${state}.tmp`, commit);
        await Deno.rename(`${state}.tmp`, state);
      },
      now: Date.now,
      probationMs: minutes * 60_000,
    },
    good
  );
  return supervisor;
}

export async function supervise(): Promise<void> {
  await initTelemetry((name) => Deno.env.get(name));
  const supervisor = await workspaceSupervisor(
    resolve(Deno.env.get('BRAIN_WORKSPACE') ?? '')
  );
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    Deno.addSignalListener(signal, () => stop.abort());
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
