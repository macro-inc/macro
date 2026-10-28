import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function publishingFixture() {
  const root = mkdtempSync(join(tmpdir(), 'web-publishing-'));
  temporaryDirectories.push(root);
  const dist = join(root, 'dist');
  const bucket = join(root, 'bucket');
  const bin = join(root, 'bin');
  const log = join(root, 'uploads.jsonl');
  mkdirSync(bin);
  mkdirSync(join(bucket, 'app'), { recursive: true });
  for (const [path, content] of Object.entries({
    'index.html': '<script src="app-abcdefgh.js"></script>',
    'pipedream-connect.html': '<script src="app-abcdefgh.js"></script>',
    'manifest.json': '{"name":"Macro"}',
    'bundle-manifest.json': '{"bundleBuild":123}',
    'semver.txt': '1.0.0',
    'sw.js': 'self.registration.unregister()',
    'app-abcdefgh.js': 'export const ready = true;',
    'assets/font-abcdefgh.woff2': 'font',
    'assets/other-abcdefgh.wasm': 'unrelated wasm',
    'app-archive.zip': 'must not overwrite the managed archive',
  })) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  }
  const compressed = brotliCompressSync(Buffer.from('cache wasm'));
  writeFileSync(join(dist, 'assets/cache_wasm_bg-hash.wasm'), 'cache wasm');
  writeFileSync(join(dist, 'assets/cache_wasm_bg-hash.wasm.br'), compressed);
  writeFileSync(join(bucket, 'app/index.html'), 'previous entrypoint');
  writeFileSync(join(bucket, 'app/app-archive.zip'), 'managed archive');
  writeFileSync(join(bucket, 'app/retained-old.js'), 'old build');
  writeFileSync(log, '');
  copyFileSync(
    resolve(import.meta.dirname, 'tests/fake-asset-upload.mjs'),
    join(bin, 'aws')
  );
  chmodSync(join(bin, 'aws'), 0o755);
  return {
    dist,
    bucket,
    compressed,
    uploads: () =>
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    run: (phase: string, failAssets = false) =>
      spawnSync(
        'bash',
        [
          resolve(import.meta.dirname, 'publish-web-assets.sh'),
          phase,
          dist,
          's3://example/app',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            FAKE_AWS_LOG: log,
            FAKE_S3_ROOT: bucket,
            FAIL_ASSETS: String(failAssets),
          },
        }
      ),
  };
}

describe('web build publication', () => {
  it('publishes immutable assets first without exposing new HTML or mutable metadata', () => {
    const fixture = publishingFixture();
    const result = fixture.run('assets');
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(fixture.bucket, 'app/index.html'), 'utf8')).toBe(
      'previous entrypoint'
    );
    expect(existsSync(join(fixture.bucket, 'app/pipedream-connect.html'))).toBe(
      false
    );
    expect(existsSync(join(fixture.bucket, 'app/bundle-manifest.json'))).toBe(
      false
    );
    expect(existsSync(join(fixture.bucket, 'app/semver.txt'))).toBe(false);
    expect(existsSync(join(fixture.bucket, 'app/sw.js'))).toBe(false);
    expect(
      readFileSync(join(fixture.bucket, 'app/assets/cache_wasm_bg-hash.wasm'))
    ).toEqual(fixture.compressed);
    expect(
      existsSync(join(fixture.bucket, 'app/assets/cache_wasm_bg-hash.wasm.br'))
    ).toBe(false);
    expect(
      readFileSync(
        join(fixture.bucket, 'app/assets/other-abcdefgh.wasm'),
        'utf8'
      )
    ).toBe('unrelated wasm');
    expect(
      readFileSync(join(fixture.bucket, 'app/app-archive.zip'), 'utf8')
    ).toBe('managed archive');
    expect(
      readFileSync(join(fixture.bucket, 'app/retained-old.js'), 'utf8')
    ).toBe('old build');
    expect(
      fixture
        .uploads()
        .every(
          (upload) =>
            upload.cacheControl === 'public, max-age=31536000, immutable'
        )
    ).toBe(true);
  });

  it('publishes HTML, manifests, version, and retirement script with no-store only after assets', () => {
    const fixture = publishingFixture();
    expect(fixture.run('assets').status).toBe(0);
    const result = fixture.run('entrypoints');
    expect(result.status, result.stderr).toBe(0);
    const uploads = fixture.uploads();
    const entrypoints = uploads.filter(
      (upload) => upload.cacheControl === 'no-store'
    );
    expect(entrypoints.map((upload) => upload.key).sort()).toEqual([
      'app/bundle-manifest.json',
      'app/index.html',
      'app/manifest.json',
      'app/pipedream-connect.html',
      'app/semver.txt',
      'app/sw.js',
    ]);
    expect(
      uploads
        .slice(0, -entrypoints.length)
        .every((upload) => upload.cacheControl.includes('immutable'))
    ).toBe(true);
    expect(readFileSync(join(fixture.bucket, 'app/index.html'), 'utf8')).toBe(
      '<script src="app-abcdefgh.js"></script>'
    );
    expect(
      readFileSync(join(fixture.bucket, 'app/app-archive.zip'), 'utf8')
    ).toBe('managed archive');
  });

  it('repairs cache metadata even when immutable bytes did not change', () => {
    const fixture = publishingFixture();
    copyFileSync(
      join(fixture.dist, 'app-abcdefgh.js'),
      join(fixture.bucket, 'app/app-abcdefgh.js')
    );
    expect(fixture.run('assets').status).toBe(0);
    expect(fixture.uploads()).toContainEqual(
      expect.objectContaining({
        key: 'app/app-abcdefgh.js',
        cacheControl: 'public, max-age=31536000, immutable',
      })
    );
  });

  it('fails the asset phase without publishing an entrypoint or removing old objects', () => {
    const fixture = publishingFixture();
    expect(fixture.run('assets', true).status).toBe(42);
    expect(readFileSync(join(fixture.bucket, 'app/index.html'), 'utf8')).toBe(
      'previous entrypoint'
    );
    expect(
      readFileSync(join(fixture.bucket, 'app/retained-old.js'), 'utf8')
    ).toBe('old build');
    expect(
      fixture.uploads().some((upload) => upload.key.endsWith('.html'))
    ).toBe(false);
  });
});
