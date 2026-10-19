import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildCommand, wasmPackages } from './wasm-packages';

const appDir = resolve(import.meta.dirname, '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'wasm' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

it('lists every WASM package the app loads, at the directory its loader reads', () => {
  const loaded = sourceFiles(join(appDir, 'src')).flatMap((file) =>
    [
      ...readFileSync(file, 'utf8').matchAll(
        /new URL\(\s*['"]([./]+(?:[\w-]+\/)*wasm)\/(\w+)\.js['"],\s*import\.meta\.url/g
      ),
    ].map(([, directory, name]) => ({
      name,
      outDir: resolve(dirname(file), directory),
    }))
  );

  expect(loaded.map(({ name }) => name).sort()).toEqual(
    wasmPackages.map(({ name }) => name).sort()
  );
  for (const { name, outDir } of loaded) {
    const listed = wasmPackages.find((p) => p.name === name);
    expect(listed && resolve(appDir, listed.outDir)).toBe(outDir);
  }
});

it('builds a package with the flags the justfile recipes used', () => {
  const agentFold = wasmPackages.find((p) => p.name === 'agent_fold');
  const figEngine = wasmPackages.find((p) => p.name === 'fig_engine');
  if (!agentFold || !figEngine) throw new Error('missing packages');
  const root = resolve(appDir, '../..');

  expect(buildCommand(agentFold)).toEqual([
    `${appDir}/scripts/cached-wasm-build.sh`,
    'agent_fold',
    `${appDir}/src/lib/core/agent-fold/wasm`,
    '--',
    'env',
    `CARGO_TARGET_DIR=${root}/target/agent-fold-wasm`,
    'wasm-pack',
    'build',
    `${root}/crates/folds/agent_fold`,
    '--target',
    'web',
    '--release',
    '--out-dir',
    `${appDir}/src/lib/core/agent-fold/wasm`,
    '--',
    '--no-default-features',
  ]);
  expect(buildCommand(figEngine)).toEqual([
    `${appDir}/scripts/cached-wasm-build.sh`,
    'fig_engine',
    `${appDir}/src/lib/core/fig-engine/wasm`,
    '--',
    'env',
    `CARGO_TARGET_DIR=${root}/target/fig-engine-wasm`,
    'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS=-C target-feature=+simd128',
    'wasm-pack',
    'build',
    `${root}/crates/fig_engine`,
    '--target',
    'web',
    '--profile',
    'fig-engine-wasm',
    '--out-dir',
    `${appDir}/src/lib/core/fig-engine/wasm`,
  ]);
});
