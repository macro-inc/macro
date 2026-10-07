import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'web-deploy-'));
  directories.push(root);
  const dist = join(root, 'dist');
  const bin = join(root, 'bin');
  mkdirSync(dist);
  mkdirSync(bin);
  for (const name of ['index.html', 'sw.js', 'app-A1bcdef0.js'])
    writeFileSync(join(dist, name), name);
  const wasm = Buffer.from('current WASM');
  writeFileSync(join(dist, 'cache_wasm_bg-A1bcdef0.wasm'), wasm);
  writeFileSync(
    join(dist, 'cache_wasm_bg-A1bcdef0.wasm.br'),
    brotliCompressSync(wasm)
  );
  const log = join(root, 'calls.jsonl');
  const manifest = join(root, 'manifest.json');
  const deletions = join(root, 'deletions.jsonl');
  const fakeAws = join(bin, 'aws');
  writeFileSync(
    fakeAws,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.AWS_TEST_LOG, JSON.stringify(args) + '\\n');
const failure = process.env.AWS_TEST_FAIL;
if (failure === 'manifest-write' ? args[2] === '-' : failure && args.some(arg => arg.includes(failure))) process.exit(42);
if (args[1] === 'list-objects-v2') process.stdout.write(process.env.AWS_TEST_KEYS || '[]');
if (args[1] === 'delete-objects') {
  const payload = fs.readFileSync(args[args.indexOf('--delete') + 1].slice('file://'.length), 'utf8');
  fs.appendFileSync(process.env.AWS_TEST_DELETIONS, payload + '\\n');
  process.stdout.write(process.env.AWS_TEST_DELETE_RESPONSE || '{}');
}
if (args[0] === 's3' && args[1] === 'cp' && args[3] === '-') process.stdout.write(process.env.AWS_TEST_PREVIOUS || '{}');
if (args[0] === 's3' && args[1] === 'cp' && args[2] === '-') fs.writeFileSync(process.env.AWS_TEST_MANIFEST, fs.readFileSync(0));
`
  );
  chmodSync(fakeAws, 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    AWS_TEST_LOG: log,
    AWS_TEST_MANIFEST: manifest,
    AWS_TEST_DELETIONS: deletions,
  };
  return {
    dist,
    run(script: string, extra: Record<string, string> = {}) {
      return spawnSync(
        script.endsWith('.sh') ? 'bash' : 'bun',
        [resolve(import.meta.dirname, script), dist, 's3://example/app'],
        { env: { ...env, ...extra }, encoding: 'utf8' }
      );
    },
    calls(): string[][] {
      return readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    },
    manifest(): Record<string, number> {
      return JSON.parse(readFileSync(manifest, 'utf8'));
    },
    deletions(): { Key: string }[][] {
      return readFileSync(deletions, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).Objects);
    },
  };
}

describe('web publication', () => {
  it('uploads dependencies before publishing HTML and the service worker, retaining previous files', () => {
    const f = fixture();
    const result = f.run('publish-to-s3.sh');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const calls = f.calls();
    expect(calls).toHaveLength(4);
    expect(calls[0].slice(0, 4)).toEqual([
      's3',
      'cp',
      join(f.dist, 'cache_wasm_bg-A1bcdef0.wasm.br'),
      's3://example/app/cache_wasm_bg-A1bcdef0.wasm',
    ]);
    expect(calls[1].slice(0, 4)).toEqual([
      's3',
      'sync',
      f.dist,
      's3://example/app',
    ]);
    expect(calls[1]).not.toContain('--delete');
    for (const excluded of [
      'index.html',
      'sw.js',
      '*cache_wasm_bg*.wasm',
      '*cache_wasm_bg*.wasm.br',
    ]) {
      expect(calls[1][calls[1].indexOf(excluded) - 1]).toBe('--exclude');
    }
    expect(calls[2].slice(0, 4)).toEqual([
      's3',
      'cp',
      join(f.dist, 'index.html'),
      's3://example/app/index.html',
    ]);
    expect(calls[3].slice(0, 4)).toEqual([
      's3',
      'cp',
      join(f.dist, 'sw.js'),
      's3://example/app/sw.js',
    ]);
    for (const call of calls.slice(2))
      expect(call[call.indexOf('--cache-control') + 1]).toBe('no-store');
  });

  it.each(['.wasm.br', 'sync'])(
    'does not publish either entry point after a %s failure',
    (failure) => {
      const f = fixture();
      expect(f.run('publish-to-s3.sh', { AWS_TEST_FAIL: failure }).status).toBe(
        42
      );
      expect(
        f
          .calls()
          .some(
            (call) => call[1] === 'cp' && /(?:index.html|sw.js)$/.test(call[2])
          )
      ).toBe(false);
    }
  );
});

describe('retired web assets', () => {
  const current = 'app/app-A1bcdef0.js';
  const expired = 'app/old-A2bcdef0.js';
  const recent = 'app/recent-A3bcdef0.js';
  const newlyRetired = 'app/unchanged-A4bcdef0.js';
  const manifestKey = 'app/.retired-assets.json';
  const day = 24 * 60 * 60 * 1000;

  it('starts a full grace period on retirement and protects current and mutable files', () => {
    const f = fixture();
    const now = Date.now();
    const result = f.run('prune-retired-assets.ts', {
      AWS_TEST_KEYS: JSON.stringify([
        current,
        expired,
        recent,
        newlyRetired,
        manifestKey,
        'app/sw.js',
        'app/app-archive.zip',
      ]),
      AWS_TEST_PREVIOUS: JSON.stringify({
        [current]: now - 30 * day,
        [expired]: now - 8 * day,
        [recent]: now - day,
      }),
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const calls = f.calls();
    expect(f.deletions()).toEqual([[{ Key: expired }]]);
    expect(calls.findIndex((call) => call[2] === '-')).toBeLessThan(
      calls.findIndex((call) => call[1] === 'delete-objects')
    );
    const manifest = f.manifest();
    expect(manifest[newlyRetired]).toBeGreaterThanOrEqual(now);
    expect(manifest[recent]).toBe(now - day);
    expect(manifest).not.toHaveProperty(current);
    expect(manifest).not.toHaveProperty('app/sw.js');
  });

  it('gives all pre-existing retired chunks a grace period on the first deployment', () => {
    const f = fixture();
    expect(
      f.run('prune-retired-assets.ts', {
        AWS_TEST_KEYS: JSON.stringify([current, expired]),
      }).status
    ).toBe(0);
    expect(f.calls().some((call) => call[1] === 'delete-objects')).toBe(false);
    expect(f.manifest()).toHaveProperty(expired);
  });

  it.each(['list-objects-v2', '.retired-assets.json', 'manifest-write'])(
    'does not delete anything when %s fails',
    (failure) => {
      const f = fixture();
      const result = f.run('prune-retired-assets.ts', {
        AWS_TEST_KEYS: JSON.stringify([expired, manifestKey]),
        AWS_TEST_PREVIOUS: JSON.stringify({ [expired]: Date.now() - 8 * day }),
        AWS_TEST_FAIL: failure,
      });
      expect(result.status).not.toBe(0);
      expect(f.calls().some((call) => call[1] === 'delete-objects')).toBe(
        false
      );
    }
  );

  it('fails safely on corrupt retirement metadata', () => {
    const f = fixture();
    expect(
      f.run('prune-retired-assets.ts', {
        AWS_TEST_KEYS: JSON.stringify([expired, manifestKey]),
        AWS_TEST_PREVIOUS: '{"app/old-A2bcdef0.js":"yesterday"}',
      }).status
    ).not.toBe(0);
    expect(f.calls().some((call) => call[1] === 'delete-objects')).toBe(false);
  });

  it('deletes large retired builds in batches of at most 1000 objects', () => {
    const f = fixture();
    const keys = Array.from(
      { length: 1001 },
      (_, index) => `app/chunk-${index}-A2bcdef0.js`
    );
    expect(
      f.run('prune-retired-assets.ts', {
        AWS_TEST_KEYS: JSON.stringify([...keys, manifestKey]),
        AWS_TEST_PREVIOUS: JSON.stringify(
          Object.fromEntries(keys.map((key) => [key, Date.now() - 8 * day]))
        ),
      }).status
    ).toBe(0);
    const batches = f.deletions();
    expect(batches.map((batch) => batch.length)).toEqual([1000, 1]);
    expect(batches.flat().map(({ Key }) => Key)).toEqual(keys);
  });

  it('reports per-object deletion errors even when the AWS command succeeds', () => {
    const f = fixture();
    const result = f.run('prune-retired-assets.ts', {
      AWS_TEST_KEYS: JSON.stringify([expired, manifestKey]),
      AWS_TEST_PREVIOUS: JSON.stringify({ [expired]: Date.now() - 8 * day }),
      AWS_TEST_DELETE_RESPONSE: JSON.stringify({
        Errors: [{ Key: expired, Code: 'AccessDenied' }],
      }),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AccessDenied');
    expect(f.manifest()).toHaveProperty(expired);
  });
});
