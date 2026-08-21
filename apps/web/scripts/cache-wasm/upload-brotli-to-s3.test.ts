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

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('cache WASM S3 upload', () => {
  it('production generic sync excludes cache raw/sidecar but not unrelated WASM', () => {
    const infrastructure = readFileSync(
      resolve(import.meta.dirname, '../../../../infra/stacks/web-app/index.ts'),
      'utf8'
    );
    expect(infrastructure).toContain(
      '--exclude "*cache_wasm_bg*.wasm" --exclude "*cache_wasm_bg*.wasm.br"'
    );
    expect(infrastructure).not.toContain('--exclude "*.wasm"');
    const uploadIndex = infrastructure.indexOf('upload-brotli-to-s3.sh');
    const syncIndex = infrastructure.indexOf('aws s3 sync ./output');
    const indexPublishIndex = infrastructure.indexOf(
      'index-html-object-metadata-command'
    );
    const pruneIndex = infrastructure.indexOf(
      'prune-old-brotli-from-s3.sh'
    );
    expect(uploadIndex).toBeLessThan(syncIndex);
    expect(syncIndex).toBeLessThan(indexPublishIndex);
    expect(indexPublishIndex).toBeLessThan(pruneIndex);
    expect(infrastructure.slice(uploadIndex, syncIndex)).toContain('&&');
    expect(infrastructure).toContain(
      'dependsOn: [webAppAssets, syncAssetsCommand]'
    );
    expect(infrastructure).toContain(
      'dependsOn: [indexHtmlObjectMetadataCommand]'
    );
  });

  it('keeps sidecars in web delivery but excludes them from native/OTA packaging', () => {
    const webJustfile = readFileSync(
      resolve(import.meta.dirname, '../../justfile'),
      'utf8'
    );
    expect(webJustfile).toMatch(
      /build-tauri:[\s\S]*package-dist --dist dist\n\s+bun scripts\/cache-wasm\/cli\.ts remove-sidecar --dist dist/
    );
    expect(webJustfile).toContain(
      `zip -qr "$TARGET" . -x '*cache_wasm_bg*.wasm.br'`
    );

    const infrastructure = readFileSync(
      resolve(import.meta.dirname, '../../../../infra/stacks/web-app/index.ts'),
      'utf8'
    );
    expect(infrastructure).toContain(
      `find ${'${shellQuote(appArchiveOutputPath)}'} -type f -name 'cache_wasm_bg*.wasm.br' -delete`
    );
    expect(infrastructure).toContain('--exclude "app-archive/*"');
  });

  it('uploads only sidecar bytes at the original WASM key with exact metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cache-wasm-upload-'));
    temporaryDirectories.push(directory);
    const dist = join(directory, 'dist');
    const assets = join(dist, 'assets');
    const bin = join(directory, 'bin');
    mkdirSync(assets, { recursive: true });
    mkdirSync(bin);
    const raw = Buffer.from('cache wasm'.repeat(1_000));
    const unrelated = Buffer.from('leave me alone');
    const rawPath = join(assets, 'cache_wasm_bg-hash.wasm');
    const sidecarPath = `${rawPath}.br`;
    const unrelatedPath = join(assets, 'other.wasm');
    writeFileSync(rawPath, raw);
    writeFileSync(sidecarPath, brotliCompressSync(raw));
    writeFileSync(unrelatedPath, unrelated);
    const argumentsPath = join(directory, 'aws-arguments.txt');
    const fakeAws = join(bin, 'aws');
    writeFileSync(
      fakeAws,
      `#!/usr/bin/env bash\nprintf '%s\\n' CALL "$@" >> ${JSON.stringify(argumentsPath)}\nif [ "\${FAIL_CP:-}" = true ] && [ "\${2:-}" = cp ]; then exit 42; fi\n`
    );
    chmodSync(fakeAws, 0o755);

    const script = resolve(import.meta.dirname, 'upload-brotli-to-s3.sh');
    const result = spawnSync(
      'bash',
      [script, dist, 's3://example/app', 'public-read'],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(argumentsPath, 'utf8').trim().split('\n')).toEqual([
      'CALL',
      's3',
      'cp',
      sidecarPath,
      's3://example/app/assets/cache_wasm_bg-hash.wasm',
      '--content-type',
      'application/wasm',
      '--content-encoding',
      'br',
      '--cache-control',
      'public, max-age=31536000, immutable',
      '--acl',
      'public-read',
    ]);
    expect(readFileSync(rawPath)).toEqual(raw);
    expect(readFileSync(unrelatedPath)).toEqual(unrelated);
  });

  it('prunes only old cache objects in its separate post-publication step', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cache-wasm-prune-'));
    temporaryDirectories.push(directory);
    const dist = join(directory, 'dist');
    const assets = join(dist, 'assets');
    const bin = join(directory, 'bin');
    mkdirSync(assets, { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(assets, 'cache_wasm_bg-current.wasm'), 'current');
    const argumentsPath = join(directory, 'aws-arguments.txt');
    const fakeAws = join(bin, 'aws');
    writeFileSync(
      fakeAws,
      `#!/usr/bin/env bash\nprintf '%s\\n' CALL "$@" >> ${JSON.stringify(argumentsPath)}\nif [ "\${1:-}" = s3api ]; then printf '%s\\n' app/assets/cache_wasm_bg-old.wasm app/assets/cache_wasm_bg-current.wasm; fi\n`
    );
    chmodSync(fakeAws, 0o755);

    const result = spawnSync(
      'bash',
      [
        resolve(import.meta.dirname, 'prune-old-brotli-from-s3.sh'),
        dist,
        's3://example/app',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }
    );
    expect(result.status).toBe(0);
    const calls = readFileSync(argumentsPath, 'utf8');
    expect(calls).toContain(
      'CALL\ns3api\nlist-objects-v2\n--bucket\nexample\n--prefix\napp/\n'
    );
    expect(calls).toContain(
      'CALL\ns3\nrm\ns3://example/app/assets/cache_wasm_bg-old.wasm\n'
    );
    expect(calls).not.toContain(
      'rm\ns3://example/app/assets/cache_wasm_bg-current.wasm'
    );
  });

  it('does not invoke pruning when the current upload fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cache-wasm-upload-fail-'));
    temporaryDirectories.push(directory);
    const dist = join(directory, 'dist');
    const assets = join(dist, 'assets');
    const bin = join(directory, 'bin');
    mkdirSync(assets, { recursive: true });
    mkdirSync(bin);
    const rawPath = join(assets, 'cache_wasm_bg-current.wasm');
    writeFileSync(rawPath, Buffer.from('current cache wasm'.repeat(100)));
    writeFileSync(
      `${rawPath}.br`,
      brotliCompressSync(readFileSync(rawPath))
    );
    const argumentsPath = join(directory, 'aws-arguments.txt');
    const fakeAws = join(bin, 'aws');
    writeFileSync(
      fakeAws,
      `#!/usr/bin/env bash\nprintf '%s\\n' CALL "$@" >> ${JSON.stringify(argumentsPath)}\nif [ "\${2:-}" = cp ]; then exit 42; fi\n`
    );
    chmodSync(fakeAws, 0o755);

    const result = spawnSync(
      'bash',
      [
        resolve(import.meta.dirname, 'upload-brotli-to-s3.sh'),
        dist,
        's3://example/app',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }
    );

    expect(result.status).toBe(42);
    const calls = readFileSync(argumentsPath, 'utf8');
    expect(calls).toContain('\ns3\ncp\n');
    expect(calls).not.toContain('\nrm\n');
  });
});
