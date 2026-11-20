import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve(import.meta.dirname, 'cli.ts');

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type Build = { root: string; wasm: string; dist: string; distWasm: string };

/** A wasm-pack output and a dist holding the copy Vite makes of it. */
function build(raw: Buffer): Build {
  const root = mkdtempSync(join(tmpdir(), 'cache-wasm-cli-'));
  temporaryDirectories.push(root);
  const wasm = join(root, 'pkg', 'cache_wasm_bg.wasm');
  const dist = join(root, 'dist');
  const distWasm = join(dist, 'assets', 'cache_wasm_bg-hash.wasm');
  mkdirSync(join(root, 'pkg'));
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(wasm, raw);
  writeFileSync(distWasm, raw);
  return { root, wasm, dist, distWasm };
}

function cli(args: string[]) {
  const result = spawnSync('bun', [CLI, ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result;
}

describe('cache WASM sidecar', () => {
  it('packages the sidecar compressed while the build ran', () => {
    const raw = Buffer.from('cache wasm '.repeat(2_000));
    const { root, wasm, dist, distWasm } = build(raw);
    const precompressed = join(root, 'target', 'cache_wasm_bg.wasm.br');

    cli(['precompress', '--wasm', wasm, '--out', precompressed]);
    const result = cli([
      'package-dist',
      '--dist',
      dist,
      '--precompressed',
      precompressed,
    ]);

    expect(result.stderr).toContain('using the sidecar compressed during the build');
    expect(readFileSync(`${distWasm}.br`)).toEqual(readFileSync(precompressed));
    expect(brotliDecompressSync(readFileSync(`${distWasm}.br`))).toEqual(raw);
  });

  it.each([
    ['of other bytes', 'other'],
    ['that is not Brotli', 'corrupt'],
    ['that is missing', 'missing'],
    ['that cannot be read', 'unreadable'],
  ])('compresses dist itself given a sidecar %s', (_, kind) => {
    const raw = Buffer.from('cache wasm '.repeat(2_000));
    const { root, wasm, dist, distWasm } = build(raw);
    const precompressed = join(root, 'target', 'cache_wasm_bg.wasm.br');
    if (kind === 'other') {
      writeFileSync(wasm, Buffer.from('an older build '.repeat(2_000)));
      cli(['precompress', '--wasm', wasm, '--out', precompressed]);
    }
    if (kind === 'corrupt') {
      mkdirSync(join(root, 'target'));
      writeFileSync(precompressed, 'not brotli');
    }
    if (kind === 'unreadable') {
      mkdirSync(precompressed, { recursive: true });
    }

    const result = cli([
      'package-dist',
      '--dist',
      dist,
      '--precompressed',
      precompressed,
    ]);

    expect(result.stderr).not.toContain('using the sidecar');
    expect(brotliDecompressSync(readFileSync(`${distWasm}.br`))).toEqual(raw);
  });
});
