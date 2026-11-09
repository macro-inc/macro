// Prints the cache key for one wasm package build: a hash of what the build
// reads, so a change elsewhere in the workspace keeps the key.
//
// - The files of the package's workspace dependency closure
//   (.github/workspace-dep-closures.json), the toolchain pin, the Nix flake and
//   its definitions (they choose wasm-pack, wasm-bindgen and binaryen), `.cargo`
//   and `static_assets`.
// - Its slice of Cargo.lock: every locked package reachable from the closure's
//   crates. Lockfile edges cover every target and dependency kind, so the slice
//   holds at least what the build compiles.
// - The root Cargo.toml without its `members` list. Dependencies, profiles,
//   patches and lints stay in.
// - The `CARGO_PROFILE_*` variables of the profile the build uses, and the
//   build command, with the checkout's own path taken out.
//
// usage: bun scripts/wasm-cache-key.ts <closure package> -- <build command...>

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

type LockPackage = {
  name: string;
  version: string;
  lines: string[];
  dependencies: string[];
};

/** Cargo.lock's `[[package]]` entries, read from the format cargo writes. */
function parseLock(lockText: string): LockPackage[] {
  const packages: LockPackage[] = [];
  let current: LockPackage | undefined;
  let inDependencies = false;

  for (const line of lockText.split('\n')) {
    if (line === '[[package]]') {
      current = { name: '', version: '', lines: [], dependencies: [] };
      packages.push(current);
      inDependencies = false;
      continue;
    }
    if (current === undefined || line.trim() === '') continue;

    current.lines.push(line);
    if (inDependencies) {
      if (line === ']') {
        inDependencies = false;
      } else {
        current.dependencies.push(line.trim().replace(/^"|",?$/g, ''));
      }
      continue;
    }

    const field = /^(\w+) = (.*)$/.exec(line);
    if (field === null) continue;
    const [, key, value] = field;
    if (key === 'name') current.name = JSON.parse(value);
    if (key === 'version') current.version = JSON.parse(value);
    if (key === 'dependencies') {
      if (value === '[') {
        inDependencies = true;
      } else {
        current.dependencies.push(...(JSON.parse(value) as string[]));
      }
    }
  }

  return packages;
}

/**
 * The Cargo.lock entries reachable from `roots` (package names), as text in a
 * fixed order.
 */
export function lockSlice(lockText: string, roots: string[]): string[] {
  const byName = new Map<string, LockPackage[]>();
  for (const lockPackage of parseLock(lockText)) {
    const sameName = byName.get(lockPackage.name) ?? [];
    sameName.push(lockPackage);
    byName.set(lockPackage.name, sameName);
  }

  // A dependency reads `name`, `name version` or `name version (source)`; the
  // version appears only when more than one version of that name is locked.
  const resolveDependency = (dependency: string): LockPackage[] => {
    const [name, version] = dependency.split(' ');
    const sameName = byName.get(name) ?? [];
    if (version === undefined) return sameName;

    return sameName.filter((lockPackage) => lockPackage.version === version);
  };

  const reached = new Set<LockPackage>();
  const pending = roots.flatMap((name) => byName.get(name) ?? []);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (reached.has(next)) continue;

    reached.add(next);
    for (const dependency of next.dependencies) {
      pending.push(...resolveDependency(dependency));
    }
  }

  return [...reached].map((lockPackage) => lockPackage.lines.join('\n')).sort();
}

/** The root manifest without the `[workspace]` table's `members` array. */
export function manifestWithoutMembers(manifestText: string): string {
  const kept: string[] = [];
  let section = '';
  let inMembers = false;

  for (const line of manifestText.split('\n')) {
    if (inMembers) {
      if (line.trim() === ']') inMembers = false;
      continue;
    }

    const header = /^\[([^\]]+)\]\s*$/.exec(line);
    if (header !== null) section = header[1];

    if (section === 'workspace' && /^members\s*=/.test(line)) {
      inMembers = !line.includes(']');
      continue;
    }

    kept.push(line);
  }

  return kept.join('\n');
}

/** The env var prefix cargo reads for the profile a build command selects. */
export function profileEnvPrefix(command: string[]): string {
  const flag = command.indexOf('--profile');
  const profile = flag === -1 ? 'release' : command[flag + 1];
  return `CARGO_PROFILE_${profile.toUpperCase().replaceAll('-', '_')}_`;
}

function git(directory: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }

  return result.stdout;
}

/** The package names declared by the closure's workspace crates. */
function crateNames(root: string, directories: string[]): string[] {
  return directories.map((directory) => {
    const manifest = readFileSync(join(root, directory, 'Cargo.toml'), 'utf8');
    let section = '';
    for (const line of manifest.split('\n')) {
      const header = /^\[([^\]]+)\]\s*$/.exec(line);
      if (header !== null) section = header[1];

      const name = /^name\s*=\s*"([^"]+)"/.exec(line);
      if (section === 'package' && name !== null) return name[1];
    }

    throw new Error(`no package name in ${directory}/Cargo.toml`);
  });
}

export function wasmCacheKey(
  root: string,
  closurePackage: string,
  command: string[],
  env: Record<string, string | undefined>
): string {
  const closures = JSON.parse(
    readFileSync(join(root, '.github/workspace-dep-closures.json'), 'utf8')
  ) as { closures: Record<string, string[]> };
  const directories = closures.closures[closurePackage] ?? [];
  if (directories.length === 0) {
    throw new Error(`no dependency closure for ${closurePackage}`);
  }

  const hash = createHash('sha256');

  const files = git(root, [
    'ls-files',
    '-z',
    '--',
    ...directories,
    'rust-toolchain.toml',
    'flake.lock',
    'flake.nix',
    'nix',
    '.cargo',
    'static_assets',
  ])
    .split('\0')
    .filter((file) => file !== '');
  for (const file of files) {
    // Symlinks (the CLAUDE.md links) count by target, as git stores them.
    const path = join(root, file);
    const isLink = lstatSync(path).isSymbolicLink();
    hash.update(`${isLink ? 'link' : 'file'} ${file}\0`);
    hash.update(isLink ? readlinkSync(path) : readFileSync(path));
    hash.update('\0');
  }

  const lock = lockSlice(
    readFileSync(join(root, 'Cargo.lock'), 'utf8'),
    crateNames(root, directories)
  );
  hash.update(`lock\0${lock.join('\0')}\0`);

  const manifest = manifestWithoutMembers(
    readFileSync(join(root, 'Cargo.toml'), 'utf8')
  );
  hash.update(`manifest\0${manifest}\0`);

  const prefix = profileEnvPrefix(command);
  const profileEnv = Object.entries(env)
    .filter(([name]) => name.startsWith(prefix))
    .map(([name, value]) => `${name}=${value ?? ''}`)
    .sort();
  hash.update(`env\0${profileEnv.join('\0')}\0`);
  // The command names this checkout's absolute paths (output and target
  // dirs); without them, every checkout of the same sources shares an entry.
  const portable = command.map((arg) => arg.replaceAll(root, '<repo>'));
  hash.update(`command\0${portable.join('\0')}\0`);

  return hash.digest('hex').slice(0, 32);
}

if (import.meta.main) {
  const [closurePackage, separator, ...command] = process.argv.slice(2);
  if (closurePackage === undefined || separator !== '--' || command.length === 0) {
    console.error(
      'usage: bun scripts/wasm-cache-key.ts <closure package> -- <build command...>'
    );
    process.exit(2);
  }

  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  console.log(wasmCacheKey(root, closurePackage, command, process.env));
}
