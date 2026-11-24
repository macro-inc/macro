// Builds the browser wasm modules listed in apps/web/wasm-modules.json.
//
//   bun scripts/wasm.ts build  [names... | --all] [--jobs N] [--variant NAME]
//   bun scripts/wasm.ts ensure [names... | --all] [--jobs N]
//
// No names means every module. `build` always runs the build, which
// cached-wasm-build.sh turns into a copy when a package with the same inputs was
// built before. `ensure` first compares the module's input key (wasm-cache-key.ts)
// with the one written next to its output by the last build, and skips the
// module when they match. `--variant` builds one of a module's `variants` (the
// cache module's browser-test-hooks and profiling builds).
//
// Each module builds with its own CARGO_TARGET_DIR, so builds run in parallel
// without waiting on each other's cargo lock; `--jobs` (default: all at once)
// caps how many run together.
//
// Built packages are kept in WASM_PKG_CACHE_DIR, which defaults to
// ~/.cache/macro/wasm-pkgs so every worktree on a machine shares them. CI sets
// its own.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { wasmCacheKey } from './wasm-cache-key';
import { readWasmManifest, type WasmModule } from './wasm-manifest';

const APP_DIR = join(import.meta.dirname, '..');
const REPO_ROOT = join(APP_DIR, '..', '..');
const CACHED_BUILD = join(import.meta.dirname, 'cached-wasm-build.sh');
/** Written into the output directory after a build: the input key it was built from. */
const KEY_FILE = '.wasm-build-key';

type Build = {
  /** The module name, or `<name>:<variant>`. */
  label: string;
  module: WasmModule;
  outDir: string;
  outName: string;
  command: string[];
};

type Options = {
  action: 'build' | 'ensure';
  names: string[];
  jobs: number;
  variant: string | undefined;
};

function usage(message: string): never {
  console.error(`${message}
usage: bun scripts/wasm.ts build|ensure [names... | --all] [--jobs N] [--variant NAME]`);
  process.exit(2);
}

function parseOptions(args: string[]): Options {
  const [action, ...rest] = args;
  if (action !== 'build' && action !== 'ensure') usage(`unknown action: ${action}`);

  const names: string[] = [];
  let jobs = Number.POSITIVE_INFINITY;
  let variant: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--all') continue;

    if (arg === '--jobs' || arg === '-j') {
      jobs = Number(rest[++index]);
      if (!Number.isInteger(jobs) || jobs < 1) usage('--jobs takes a positive integer');
      continue;
    }

    if (arg === '--variant') {
      variant = rest[++index];
      if (variant === undefined) usage('--variant takes a name');
      continue;
    }

    if (arg.startsWith('-')) usage(`unknown option: ${arg}`);
    names.push(arg);
  }

  if (variant !== undefined && action !== 'build') usage('--variant only applies to build');

  return { action, names, jobs, variant };
}

/** The wasm-pack invocation for one module, as the cache key sees it. */
export function buildCommand(
  root: string,
  module: WasmModule,
  outDir: string,
  outName: string,
  profile: string,
  features: string[]
): string[] {
  const env = [`CARGO_TARGET_DIR=${join(root, 'target', 'wasm', module.name)}`];
  if (module.rustflags.length > 0) {
    env.push(`CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS=${module.rustflags.join(' ')}`);
  }

  const cargoArgs: string[] = [];
  if (!module.defaultFeatures) cargoArgs.push('--no-default-features');
  if (features.length > 0) cargoArgs.push('--features', features.join(','));

  return [
    'env',
    ...env,
    'wasm-pack',
    'build',
    join(root, module.crateDir),
    '--target',
    'web',
    ...(profile === 'release' ? ['--release'] : ['--profile', profile]),
    '--out-dir',
    join(root, 'apps', 'web', outDir),
    '--out-name',
    outName,
    ...(cargoArgs.length > 0 ? ['--', ...cargoArgs] : []),
  ];
}

function planBuild(module: WasmModule, variantName: string | undefined): Build {
  if (variantName === undefined) {
    return {
      label: module.name,
      module,
      outDir: join(APP_DIR, module.outDir),
      outName: module.outName,
      command: buildCommand(
        REPO_ROOT,
        module,
        module.outDir,
        module.outName,
        module.profile,
        module.features
      ),
    };
  }

  const variant = module.variants?.[variantName];
  if (variant === undefined) usage(`${module.name} has no variant ${variantName}`);

  const outDir = variant.outDir ?? module.outDir;
  const outName = variant.outName ?? module.outName;
  return {
    label: `${module.name}:${variantName}`,
    module,
    outDir: join(APP_DIR, outDir),
    outName,
    command: buildCommand(
      REPO_ROOT,
      module,
      outDir,
      outName,
      variant.profile ?? module.profile,
      variant.features ?? module.features
    ),
  };
}

function inputKey(build: Build, env: NodeJS.ProcessEnv): string {
  return wasmCacheKey(REPO_ROOT, build.module.package, build.command, env);
}

function builtKey(build: Build): string | undefined {
  const wasm = join(build.outDir, `${build.outName}_bg.wasm`);
  const keyFile = join(build.outDir, KEY_FILE);
  if (!existsSync(wasm) || !existsSync(keyFile)) return undefined;

  return readFileSync(keyFile, 'utf8').trim();
}

/** Prints a child's output a line at a time, prefixed with its module. */
function prefixLines(stream: NodeJS.ReadableStream, label: string, to: NodeJS.WriteStream) {
  createInterface({ input: stream }).on('line', (line) => {
    to.write(`[${label}] ${line}\n`);
  });
}

async function runBuild(build: Build, key: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  // A key left from an earlier build would mark an interrupted one as current.
  rmSync(join(build.outDir, KEY_FILE), { force: true });

  const child = spawn(
    CACHED_BUILD,
    [build.module.package, build.outDir, '--', ...build.command],
    { cwd: APP_DIR, env: { ...env, WASM_PKG_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  prefixLines(child.stdout, build.label, process.stdout);
  prefixLines(child.stderr, build.label, process.stderr);

  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  if (code !== 0) {
    console.error(`[${build.label}] failed (exit ${code})`);
    return false;
  }

  writeFileSync(join(build.outDir, KEY_FILE), `${key}\n`);
  return true;
}

/** Runs `tasks` with at most `limit` at once; stops starting new ones after a failure. */
async function runLimited(
  tasks: (() => Promise<boolean>)[],
  limit: number
): Promise<boolean> {
  let next = 0;
  let ok = true;
  const worker = async () => {
    while (ok && next < tasks.length) {
      const task = tasks[next++];
      if (!(await task())) ok = false;
    }
  };

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return ok;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const modules = readWasmManifest();
  const byName = new Map(modules.map((module) => [module.name, module]));

  const selected =
    options.names.length === 0
      ? modules
      : options.names.map((name) => {
          const module = byName.get(name);
          if (module === undefined) {
            usage(`unknown wasm module ${name}; known: ${[...byName.keys()].join(', ')}`);
          }
          return module;
        });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WASM_PKG_CACHE_DIR:
      process.env.WASM_PKG_CACHE_DIR ?? join(homedir(), '.cache', 'macro', 'wasm-pkgs'),
  };

  const tasks: (() => Promise<boolean>)[] = [];
  for (const module of selected) {
    const build = planBuild(module, options.variant);
    const key = inputKey(build, env);
    if (options.action === 'ensure' && builtKey(build) === key) {
      console.log(`[${build.label}] up to date (${key})`);
      continue;
    }

    tasks.push(() => runBuild(build, key, env));
  }

  if (!(await runLimited(tasks, options.jobs))) process.exit(1);
}

if (import.meta.main) {
  await main();
}
