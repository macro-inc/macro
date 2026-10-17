#!/usr/bin/env bun
/**
 * The Rust WASM packages the app loads at runtime, listed in
 * wasm-packages.json. `just build-wasm` builds them through this script and
 * nix/tauri-desktop.nix builds the same list, so neither app build can leave
 * one out.
 *
 * usage: bun scripts/wasm-packages.ts build <name...|--all>
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import manifest from '../wasm-packages.json' with { type: 'json' };

export interface WasmPackage {
  /** wasm-pack's output stem: `<name>.js` and `<name>_bg.wasm`. */
  name: string;
  /** Cargo package, also its key in .github/workspace-dep-closures.json. */
  package: string;
  crate: string;
  outDir: string;
  targetDir: string;
  profile: string;
  rustflags?: string;
  cargoArgs?: string[];
}

export const wasmPackages: WasmPackage[] = manifest.packages;

const appDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(appDir, '../..');

export function buildCommand(wasmPackage: WasmPackage): string[] {
  const outDir = resolve(appDir, wasmPackage.outDir);
  return [
    resolve(appDir, 'scripts/cached-wasm-build.sh'),
    wasmPackage.package,
    outDir,
    '--',
    'env',
    `CARGO_TARGET_DIR=${resolve(repoRoot, wasmPackage.targetDir)}`,
    ...(wasmPackage.rustflags
      ? [`CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS=${wasmPackage.rustflags}`]
      : []),
    'wasm-pack',
    'build',
    resolve(repoRoot, wasmPackage.crate),
    '--target',
    'web',
    ...(wasmPackage.profile === 'release'
      ? ['--release']
      : ['--profile', wasmPackage.profile]),
    '--out-dir',
    outDir,
    ...(wasmPackage.cargoArgs ? ['--', ...wasmPackage.cargoArgs] : []),
  ];
}

function run([command, ...args]: string[]): Promise<number> {
  return new Promise((done, fail) => {
    spawn(command, args, { stdio: 'inherit' })
      .on('error', fail)
      .on('exit', (code) => done(code ?? 1));
  });
}

if (import.meta.main) {
  const [command, ...names] = process.argv.slice(2);
  if (command !== 'build' || names.length === 0) {
    throw new Error('usage: wasm-packages.ts build <name...|--all>');
  }
  const selected =
    names[0] === '--all'
      ? wasmPackages
      : names.map((name) => {
          const found = wasmPackages.find((p) => p.name === name);
          if (!found) throw new Error(`no WASM package named ${name}`);
          return found;
        });
  // The packages use separate target directories, so they build in parallel
  // without serializing on Cargo's lock.
  const codes = await Promise.all(selected.map((p) => run(buildCommand(p))));
  process.exit(codes.every((code) => code === 0) ? 0 : 1);
}
