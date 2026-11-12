// The local stack the eval runs against: where its services are, signing in
// as a seeded person, an SDK client for them, and a lock so one draft at a
// time runs on it, whichever worker started it.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { homedir, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { Macro } from '../../../packages/sdk/src/macro';

export type Stack = {
  instance: string;
  /** The stack's MacroDB, for reading what a run changed. */
  postgres: string;
  /** The checkout that started the stack: its compose files live there. */
  owner: string;
  auth: string;
  harness: string;
  storage: string;
  webApp: string;
  tempo: string;
  hosts: Record<string, string>;
};

const REPO = resolve(import.meta.dir, '../../..');

/**
 * The instance's portmap, from this checkout or from the worktree that
 * started it: a stack belongs to the checkout `run_local` ran in, and other
 * worktrees share it.
 */
function portmapPath(instance: string): string {
  const here = join(REPO, 'infra/local/generated', instance, 'portmap.json');
  if (existsSync(here)) return here;
  const listing = Bun.spawnSync(['git', 'worktree', 'list', '--porcelain'], { cwd: REPO }).stdout.toString();
  for (const line of listing.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const path = join(line.slice('worktree '.length), 'infra/local/generated', instance, 'portmap.json');
    if (existsSync(path)) return path;
  }
  throw new Error(`no portmap for instance ${instance}; start it with \`just run_local --instance ${instance}\``);
}

/** The instance's port block, from `run_local`'s registry. */
function portBase(instance: string): number {
  const registry = JSON.parse(
    readFileSync(join(homedir(), '.local/state/macro-local/instances.json'), 'utf8'),
  ) as Record<string, { port_base: number }>;
  const entry = registry[instance];
  if (!entry) throw new Error(`instance ${instance} is not in the run_local registry`);
  return entry.port_base;
}

export function stack(instance: string, tempo: string): Stack {
  const path = portmapPath(instance);
  const portmap = JSON.parse(readFileSync(path, 'utf8')) as {
    webAppUrl: string;
    hosts: Record<string, string>;
  };
  return {
    instance,
    // Postgres takes the first port of the instance's block.
    postgres: `postgres://user:password@localhost:${portBase(instance)}/macrodb`,
    owner: resolve(dirname(path), '../../../..'),
    auth: portmap.hosts.auth,
    harness: portmap.hosts.cognition.replace(/\/cognition$/, ''),
    storage: portmap.hosts.storage,
    webApp: portmap.webAppUrl,
    tempo,
    hosts: portmap.hosts,
  };
}

/**
 * The stack's search indexer and the internal key its backfill routes take,
 * from the compose override and env `run_local` generated: the portmap lists
 * only what the web app calls.
 */
export function searchIndexer(at: Stack): { url: string; key: string } {
  const generated = join(at.owner, 'infra/local/generated', at.instance);
  const compose = readFileSync(join(generated, 'docker-compose.override.yml'), 'utf8');
  const service = compose.split(/\n {2}search_processing_service:\n/)[1]?.split(/\n {2}\S/)[0];
  const port = service?.match(/- (\d+):8080/)?.[1];
  if (!port) throw new Error(`${at.instance} runs no search_processing_service, so nothing indexes it for search`);
  const env = readFileSync(join(generated, 'local.generated.env'), 'utf8');
  const key = env.match(/^INTERNAL_API_KEY=(.*)$/m)?.[1];
  if (!key) throw new Error(`no INTERNAL_API_KEY in ${at.instance}'s generated env`);
  return { url: `http://localhost:${port}`, key };
}

/** A Macro API token for `email`, through local passwordless login. */
export async function login(at: Stack, email: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const started = await fetch(`${at.auth}/login/passwordless`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirect_uri: `${at.webApp}/app` }),
      });
      const { code } = (await started.json()) as { code?: string };
      if (!code) throw new Error(`no passwordless code for ${email}; seed the workspace first (drafts.ts seed)`);
      const tokens = await fetch(
        `${at.auth}/oauth/passwordless/${code}?email=${encodeURIComponent(email)}&disable_redirect=true`,
      );
      const { access_token } = (await tokens.json()) as { access_token: string };
      const api = await fetch(`${at.auth}/jwt/macro_api_token`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!api.ok) throw new Error(`macro_api_token ${api.status}`);
      return ((await api.json()) as { macro_api_token: string }).macro_api_token;
    } catch (error) {
      // FusionAuth sometimes refuses a login while it's busy.
      if (attempt >= 4) throw error;
      await Bun.sleep(2000);
    }
  }
}

/** An SDK client acting as the holder of `token`, pointed at the stack. */
export function sdk(at: Stack, token: string): Macro {
  const h = at.hosts;
  return new Macro({
    token,
    env: 'local',
    webAppUrl: at.webApp,
    hosts: {
      'agent-harness': at.harness,
      cognition: `${at.harness}/cognition`,
      'scheduled-action': `${at.harness}/scheduled-action`,
      storage: h.storage,
      properties: h.properties,
      search: h.search,
      auth: h.auth,
      contacts: h.contacts,
      email: h.email,
      notification: h.notification,
      connection: h.connection,
      'static-files': h['static-files'],
      unfurl: h.unfurl,
    },
  });
}

/** A JSON request to the stack that throws on an error status. */
export async function call<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------- one draft at a time ----------

const LOCK_DIR = join(homedir(), '.cache/routines-eval/locks');

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Another user's process is alive too.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** A lock file is written as soon as it's made, so one still empty after this was left by a crash. */
const UNWRITTEN_MS = 30_000;

/**
 * Holds the instance while `work` runs, waiting for any other eval's draft
 * to finish first. Checks land in traces of their own and are matched to a
 * draft by time, and a second draft would also share the model and the
 * machine, so drafts on one stack never overlap.
 */
export async function exclusive<T>(instance: string, label: string, work: () => Promise<T>): Promise<T> {
  // Held already by this process: an `ab` segment holds it across its drafts.
  if (holding.has(instance)) return work();
  mkdirSync(LOCK_DIR, { recursive: true });
  const path = join(LOCK_DIR, `${instance}.lock`);
  let waited = false;
  for (;;) {
    let fd: number | undefined;
    try {
      fd = openSync(path, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (fd !== undefined) {
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, label, since: new Date().toISOString() }));
      } catch (error) {
        unlinkSync(path);
        throw error;
      } finally {
        closeSync(fd);
      }
      break;
    }
    let raw = '';
    let holder: { pid?: number; label?: string } = {};
    let seen: { ino: number; mtimeMs: number } | undefined;
    try {
      seen = statSync(path);
      raw = readFileSync(path, 'utf8');
      holder = JSON.parse(raw);
    } catch {}
    const age = seen ? Date.now() - seen.mtimeMs : 0;
    if ((holder.pid && !alive(holder.pid)) || (!holder.pid && age > UNWRITTEN_MS)) {
      // Only the dead holder's file: another waiter may have taken the lock
      // since, and a fresh lock not yet written reads the same as an old one.
      try {
        const now = statSync(path);
        if (now.ino === seen?.ino && now.mtimeMs === seen.mtimeMs && readFileSync(path, 'utf8') === raw) unlinkSync(path);
      } catch {}
      continue;
    }
    if (!waited) console.log(`waiting for ${holder.label ?? 'another eval'} (pid ${holder.pid}) on ${instance}`);
    waited = true;
    await Bun.sleep(1000);
  }
  holding.add(instance);
  try {
    return await work();
  } finally {
    holding.delete(instance);
    try {
      unlinkSync(path);
    } catch {}
  }
}

const holding = new Set<string>();

// ---------- what else was running ----------

export type Load = {
  /** One-minute load average when the draft started and ended. */
  load1: [number, number];
  /** Compilers running when the draft started: other builds on the box. */
  compilers: number;
};

/** Processes named like a compiler, from /proc. */
function compilers(): number {
  let count = 0;
  for (const entry of new Bun.Glob('[0-9]*').scanSync({ cwd: '/proc', onlyFiles: false })) {
    try {
      const name = readFileSync(`/proc/${entry}/comm`, 'utf8').trim();
      if (name === 'rustc' || name === 'cc1' || name === 'cc1plus' || name === 'ld' || name === 'mold') count++;
    } catch {}
  }
  return count;
}

export function loadStart(): { load1: number; compilers: number } {
  return { load1: loadavg()[0], compilers: compilers() };
}

export function loadEnd(start: { load1: number; compilers: number }): Load {
  return { load1: [start.load1, loadavg()[0]], compilers: start.compilers };
}

/** The local stacks whose agent harness is running, from Docker, once per run. */
export function runningHarnesses(): string[] {
  const out = Bun.spawnSync(
    ['nix', 'develop', '--command', 'docker', 'ps', '--filter', 'name=agent_harness_service', '--format', '{{.Names}}'],
    { cwd: REPO, stderr: 'ignore' },
  );
  return out.stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('macro-'))
    .map((line) => line.replace(/^macro-/, '').replace(/-agent_harness_service-\d+$/, ''));
}

// ---------- which build answers ----------

/**
 * Recreate the stack's agent harness on the build in `bin` (a directory
 * holding `agent_harness_service`, such as a worktree's `target/debug` or a
 * copy kept outside one), and wait until it answers. Copy a build out of a
 * worktree first when that worktree may build again mid-run.
 */
const harnessOverride = (instance: string) => join(homedir(), '.cache/routines-eval', `${instance}.harness.override.yml`);

/**
 * The build the stack's harness runs, as `useHarness` last set it, or
 * undefined when nothing here has set it. Recorded on every draft, since
 * another eval may switch builds between two of a run's drafts.
 */
export function currentHarness(instance: string): string | undefined {
  try {
    return readFileSync(harnessOverride(instance), 'utf8').match(/- (\S+):\/app\/out:ro/)?.[1];
  } catch {
    return undefined;
  }
}

export async function useHarness(at: Stack, bin: string) {
  if (!existsSync(join(bin, 'agent_harness_service'))) throw new Error(`no agent_harness_service in ${bin}`);
  const override = harnessOverride(at.instance);
  mkdirSync(dirname(override), { recursive: true });
  writeFileSync(
    override,
    [
      '# Written by crates/scheduled_action/bench: the build the eval drafts against.',
      'services:',
      '  agent_harness_service:',
      '    volumes: !override',
      `      - ${resolve(bin)}:/app/out:ro`,
      '      - /nix/store:/nix/store:ro',
      '      - /var/run/docker.sock:/var/run/docker.sock',
      '',
    ].join('\n'),
  );
  await recreateHarness(at, override);
}

/** Back to `bin`, or with none to the build the stack started with. */
export async function restoreHarness(at: Stack, bin: string | undefined) {
  if (bin) return useHarness(at, bin);
  const override = harnessOverride(at.instance);
  if (!existsSync(override)) return;
  unlinkSync(override);
  await recreateHarness(at);
}

/** Recreate the harness container from the stack's compose files, plus `override`, and wait until it answers. */
async function recreateHarness(at: Stack, override?: string) {
  const generated = join(at.owner, 'infra/local/generated', at.instance);
  const env = join(generated, 'local.generated.env');
  const compose = [
    `COMPOSE_PROJECT_NAME=macro-${at.instance}`,
    `MACRO_ENV_FILE=${env}`,
    'docker compose --project-directory .',
    `--env-file ${env}`,
    '-f docker/docker-compose.yml',
    `-f ${join(generated, 'docker-compose.override.yml')}`,
    ...(override ? [`-f ${override}`] : []),
    'up -d --no-deps --no-build --force-recreate agent_harness_service',
  ].join(' ');
  const result = Bun.spawnSync(['nix', 'develop', '--command', 'bash', '-c', compose], {
    cwd: at.owner,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) throw new Error(`recreating the harness exited with ${result.exitCode}`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetch(`${at.harness}/scheduled-action/scheduled-actions/catalog`).catch(() => undefined);
    // Up once it answers, even if only to say who may ask.
    if (response && response.status < 500) return;
    await Bun.sleep(2000);
  }
  throw new Error('the harness did not come back within 4 minutes');
}
