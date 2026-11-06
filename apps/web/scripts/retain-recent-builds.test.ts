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
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, 'retain-recent-builds.sh');

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type Bucket = {
  /** Build number to the keys that build published. */
  records: Record<string, string[]>;
  /** Every key currently in the bucket under the prefix. */
  objects: string[];
  /** Keys S3 refuses to delete, reported in a response that still exits 0. */
  refuse?: string[];
};

/**
 * Runs the script against a fake `aws` that answers from `bucket` and records
 * what it was asked to delete.
 */
function run(
  distFiles: Record<string, string>,
  bucket: Bucket,
  keepBuilds: number
) {
  const root = mkdtempSync(join(tmpdir(), 'retain-builds-'));
  temporaryDirectories.push(root);
  const dist = join(root, 'dist');
  const bin = join(root, 'bin');
  const state = join(root, 'bucket.json');
  const deletions = join(root, 'deleted.txt');
  const uploads = join(root, 'uploaded.txt');
  const batches = join(root, 'batches.txt');
  mkdirSync(bin, { recursive: true });
  for (const [path, contents] of Object.entries(distFiles)) {
    const full = join(dist, path);
    mkdirSync(resolve(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  writeFileSync(state, JSON.stringify(bucket));
  writeFileSync(deletions, '');
  writeFileSync(uploads, '');
  writeFileSync(batches, '');

  // Only the shapes the script uses: list keys, read a record, delete.
  const fakeAws = join(bin, 'aws');
  writeFileSync(
    fakeAws,
    `#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require('node:fs');
const bucket = JSON.parse(readFileSync(${JSON.stringify(state)}, 'utf8'));
const argv = process.argv.slice(2);
if (argv[0] === 's3api' && argv[1] === 'list-objects-v2') {
  const prefix = argv[argv.indexOf('--prefix') + 1] ?? '';
  const keys = prefix.endsWith('_builds/')
    ? Object.keys(bucket.records).map((build) => prefix + build + '.txt')
    : bucket.objects.filter((key) => key.startsWith(prefix));
  // Exit after the write: process.exit() truncates output to a pipe.
  process.stdout.write(keys.length ? keys.join('\\t') + '\\n' : 'None\\n', () =>
    process.exit(0)
  );
  return;
}
if (argv[0] === 's3' && argv[1] === 'cp' && argv[3] === '-') {
  const build = argv[2].replace(/.*\\/(\\d+)\\.txt$/, '$1');
  process.stdout.write((bucket.records[build] ?? []).join('\\n') + '\\n');
  process.exit(0);
}
if (argv[0] === 's3' && argv[1] === 'cp') {
  // Uploading a record makes it visible to the listing, as S3 would.
  const build = argv[3].replace(/.*\\/(\\d+)\\.txt$/, '$1');
  bucket.records[build] = readFileSync(argv[2], 'utf8').split('\\n').filter(Boolean);
  writeFileSync(${JSON.stringify(state)}, JSON.stringify(bucket));
  appendFileSync(${JSON.stringify(uploads)}, argv[3] + '\\n');
  process.exit(0);
}
if (argv[0] === 's3' && argv[1] === 'rm') {
  appendFileSync(${JSON.stringify(deletions)}, argv[2] + '\\n');
  process.exit(0);
}
if (argv[0] === 's3api' && argv[1] === 'delete-objects') {
  const path = argv[argv.indexOf('--delete') + 1].replace('file://', '');
  const keys = JSON.parse(readFileSync(path, 'utf8')).Objects.map((o) => o.Key);
  appendFileSync(${JSON.stringify(batches)}, keys.length + '\\n');
  const refused = keys.filter((key) => (bucket.refuse ?? []).includes(key));
  for (const key of keys) {
    if (!refused.includes(key)) {
      appendFileSync(${JSON.stringify(deletions)}, 's3://example/' + key + '\\n');
    }
  }
  // S3 reports a refused key in the response and the CLI still exits 0.
  process.stdout.write(
    refused.length
      ? JSON.stringify(refused.map((Key) => ({ Key, Code: 'AccessDenied' })))
      : 'null'
  );
  process.exit(0);
}
process.stderr.write('unexpected aws call: ' + argv.join(' ') + '\\n');
process.exit(1);
`
  );
  chmodSync(fakeAws, 0o755);

  const result = spawnSync(
    'bash',
    [script, dist, 's3://example/app', String(keepBuilds)],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    }
  );
  const lines = (path: string) =>
    readFileSync(path, 'utf8').split('\n').filter(Boolean);
  return {
    result,
    deleted: lines(deletions).map((uri) => uri.replace('s3://example/', '')),
    uploaded: lines(uploads),
    batchSizes: lines(batches).map(Number),
  };
}

const manifest = (build: number) =>
  JSON.stringify({ schemaVersion: 3, bundleBuild: build });

describe('retaining recent builds', () => {
  it('keeps what recent builds still refer to and drops what none do', () => {
    const { result, deleted } = run(
      {
        'bundle-manifest.json': manifest(300),
        'index.html': '<html></html>',
        'app-new.js': '',
        'fold.worker-new.js': '',
      },
      {
        records: {
          '100': ['app/index.html', 'app/app-ancient.js'],
          '200': ['app/index.html', 'app/app-previous.js'],
        },
        objects: [
          'app/index.html',
          'app/app-ancient.js',
          'app/app-previous.js',
          'app/app-new.js',
          'app/fold.worker-new.js',
        ],
      },
      2
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    // The window counts the build being published, so 2 is 300 and 200; build
    // 100 falls out, and its record goes with its assets.
    expect(deleted).toEqual(['app/_builds/100.txt', 'app/app-ancient.js']);
  });

  it('keeps the previous build so an open tab can still fetch it lazily', () => {
    const { deleted } = run(
      {
        'bundle-manifest.json': manifest(300),
        'index.html': '',
        'fold.worker-new.js': '',
      },
      {
        records: { '200': ['app/fold.worker-previous.js'] },
        objects: ['app/fold.worker-previous.js', 'app/fold.worker-new.js'],
      },
      10
    );

    // The exact failure this change exists for: a tab on build 200 has not
    // constructed its fold worker yet when build 300 lands.
    expect(deleted).toEqual([]);
  });

  it('never deletes what the build being published just wrote', () => {
    const { deleted } = run(
      {
        'bundle-manifest.json': manifest(300),
        'index.html': '',
        'app-new.js': '',
      },
      // No record survives to vouch for the live build.
      { records: {}, objects: ['app/app-new.js', 'app/index.html'] },
      1
    );

    expect(deleted).toEqual([]);
  });

  it('leaves objects it does not own alone', () => {
    const { deleted } = run(
      { 'bundle-manifest.json': manifest(300), 'index.html': '' },
      {
        records: {},
        objects: [
          'app/index.html',
          'app/app-archive.zip',
          'app/assets/cache_wasm_bg-hash.wasm',
          'app/assets/orphan-hash.js',
        ],
      },
      1
    );

    // The archive is its own resource and the cache WASM has its own prune.
    expect(deleted).toEqual(['app/assets/orphan-hash.js']);
  });

  it('retires records beyond the retention window with their assets', () => {
    const { deleted, uploaded } = run(
      { 'bundle-manifest.json': manifest(400), 'index.html': '' },
      {
        records: {
          '100': ['app/a.js'],
          '200': ['app/b.js'],
          '300': ['app/c.js'],
        },
        objects: ['app/index.html', 'app/a.js', 'app/b.js', 'app/c.js'],
      },
      2
    );

    expect(uploaded).toEqual(['s3://example/app/_builds/400.txt']);
    // A window of 2 is the build being published (400) and the one before it
    // (300), so 200 and 100 are retired along with what only they referred to.
    expect(deleted).toEqual(
      expect.arrayContaining([
        'app/_builds/200.txt',
        'app/_builds/100.txt',
        'app/a.js',
        'app/b.js',
      ])
    );
    expect(deleted).not.toContain('app/c.js');
    expect(deleted).not.toContain('app/index.html');
  });

  it('deletes in batches no larger than S3 accepts', () => {
    const orphans = Array.from({ length: 2500 }, (_, i) => `app/orphan-${i}.js`);
    const { result, deleted, batchSizes } = run(
      { 'bundle-manifest.json': manifest(300), 'index.html': '' },
      { records: {}, objects: ['app/index.html', ...orphans] },
      1
    );

    expect(result.status).toBe(0);
    expect(batchSizes).toEqual([1000, 1000, 500]);
    expect(deleted.toSorted()).toEqual(orphans.toSorted());
  });

  it('sends no delete request when nothing is prunable', () => {
    const { result, batchSizes } = run(
      { 'bundle-manifest.json': manifest(300), 'index.html': '' },
      { records: {}, objects: ['app/index.html'] },
      1
    );

    expect(result.status).toBe(0);
    expect(batchSizes).toEqual([]);
  });

  it('fails the deploy when S3 refuses to delete a key', () => {
    const { result, deleted } = run(
      { 'bundle-manifest.json': manifest(300), 'index.html': '' },
      {
        records: {},
        objects: ['app/index.html', 'app/a.js', 'app/b.js'],
        refuse: ['app/b.js'],
      },
      1
    );

    // DeleteObjects exits 0 with per-key errors; the old per-key call failed
    // the script, so a refusal must not start passing silently.
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('app/b.js');
    expect(deleted).toEqual(['app/a.js']);
  });

  it('refuses to prune output that is not a build', () => {
    const { result, deleted } = run(
      { 'bundle-manifest.json': manifest(300) },
      { records: {}, objects: ['app/app-live.js'] },
      10
    );

    // A shell-less dist would otherwise read as "no build refers to anything",
    // and take the live assets with it.
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refusing to prune');
    expect(deleted).toEqual([]);
  });

  it('refuses to run without a bundle manifest', () => {
    const { result } = run(
      { 'index.html': '' },
      { records: {}, objects: [] },
      10
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('bundle manifest');
  });
});
