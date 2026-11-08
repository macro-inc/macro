import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
export const pkg = path.join(root, 'packages/lexical-conformance');
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      TMPDIR: '/home/wolf/tmp',
      CARGO_BUILD_JOBS: '4',
      CARGO_TARGET_DIR: path.join(root, 'target'),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`);
}
/** Content-address the v0 dependency closure; build optimized Node and web artifacts. */
export function buildWasm() {
  if (process.env.LEXICAL_BUILD_LOCKED !== '1') {
    mkdirSync(path.join(root, 'target'), { recursive: true });
    run('flock', [
      path.join(root, 'target/lexical-conformance-build.lock'),
      'env',
      'LEXICAL_BUILD_LOCKED=1',
      'bun',
      fileURLToPath(import.meta.url),
    ]);
    return;
  }
  const hash = createHash('sha256');
  for (const command of ['rustc', 'cargo', 'wasm-bindgen', 'wasm-opt']) {
    const version = spawnSync(command, ['--version'], { encoding: 'utf8' });
    if (version.status !== 0) throw new Error(`Cannot read ${command} version`);
    hash.update(command).update(version.stdout);
  }
  function add(file: string) {
    if (readdirSync(path.dirname(file)).includes(path.basename(file)))
      hash.update(file).update(readFileSync(file));
  }
  function directory(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) directory(file);
      else add(file);
    }
  }
  for (const name of ['lexical_model', 'lexical_conformance_wasm'])
    directory(path.join(root, 'crates/client/lexical', name));
  for (const name of [
    'Cargo.toml',
    'Cargo.lock',
    'packages/lexical-conformance/upstream.lock',
    'packages/lexical-conformance/diff/build-wasm.ts',
  ])
    add(path.join(root, name));
  const stamp = hash.digest('hex');
  const output = path.join(pkg, 'pkg');
  const cache = path.join(output, '.build-hash');
  if (
    existsSync(cache) &&
    readFileSync(cache, 'utf8') === stamp &&
    ['node', 'web'].every((target) =>
      [
        'lexical_conformance_wasm_bg.wasm',
        'lexical_conformance_wasm.js',
        'lexical_conformance_wasm.d.ts',
      ].every((name) => existsSync(path.join(output, target, name)))
    )
  )
    return;
  run('cargo', [
    'build',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
    '-p',
    'lexical_conformance_wasm',
    '-j4',
  ]);
  for (const target of ['nodejs', 'web']) {
    const out = path.join(output, target === 'nodejs' ? 'node' : 'web');
    mkdirSync(out, { recursive: true });
    run('wasm-bindgen', [
      path.join(
        root,
        'target/wasm32-unknown-unknown/release/lexical_conformance_wasm.wasm'
      ),
      '--target',
      target,
      '--out-dir',
      out,
    ]);
    run('wasm-opt', [
      '-O3',
      '--enable-bulk-memory',
      '--enable-nontrapping-float-to-int',
      path.join(out, 'lexical_conformance_wasm_bg.wasm'),
      '-o',
      path.join(out, 'lexical_conformance_wasm_bg.wasm'),
    ]);
    writeFileSync(
      path.join(out, 'package.json'),
      JSON.stringify({
        private: true,
        type: target === 'nodejs' ? 'commonjs' : 'module',
      })
    );
  }
  writeFileSync(cache, stamp);
}

if (import.meta.main || process.env.LEXICAL_BUILD_LOCKED === '1') buildWasm();
