import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSmokeHandler,
  prepareArtifacts,
} from './smoke-bundle-updater-server';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(
  indexHtml = '<html><head><meta name="macro-bundle-build" content="100" /></head><body><div id="root"></div></body></html>'
) {
  const directory = mkdtempSync(join(tmpdir(), 'macro-bundle-smoke-'));
  directories.push(directory);
  const distDir = join(directory, 'dist');
  const workDir = join(directory, 'smoke');
  mkdirSync(distDir);
  writeFileSync(join(distDir, 'index.html'), indexHtml);
  writeFileSync(
    join(distDir, 'bundle-manifest.json'),
    JSON.stringify({ bundleBuild: 100 })
  );
  writeFileSync(join(distDir, 'app.js'), 'console.log("fixture")');
  return { distDir, workDir, appVersion: '2.5.0', indexHtml };
}

function request(build: number, nativeBuild = 0) {
  return new Request(
    `http://127.0.0.1:3001/update/bundle/darwin/aarch64?current_bundle_build=${build}&native_build=${nativeBuild}`
  );
}

describe('local bundle updater smoke server', () => {
  it('packages matching manifest and document builds without changing the embedded baseline', () => {
    const paths = fixture();
    const artifacts = prepareArtifacts(paths);

    for (const [build, artifact] of artifacts) {
      const unzip = (name: string) =>
        execFileSync('unzip', ['-p', artifact.zipPath, name], {
          encoding: 'utf8',
        });
      expect(JSON.parse(unzip('bundle-manifest.json'))).toEqual({
        schemaVersion: 2,
        bundleBuild: build,
        minNativeBuild: build === 102 ? 999999 : 0,
        gitSha: 'smoke',
        appVersion: '2.5.0',
      });
      expect(unzip('index.html')).toContain(
        `name="macro-bundle-build" content="${build}"`
      );
      expect(unzip('index.html')).toContain(`OTA smoke build ${build}`);
      expect(unzip('app.js')).toBe('console.log("fixture")');
      expect(artifact.checksum).toBe(
        createHash('sha256')
          .update(readFileSync(artifact.zipPath))
          .digest('hex')
      );
    }
    expect(readFileSync(join(paths.distDir, 'index.html'), 'utf8')).toBe(
      paths.indexHtml
    );
    expect(
      JSON.parse(
        readFileSync(join(paths.distDir, 'bundle-manifest.json'), 'utf8')
      )
    ).toEqual({ bundleBuild: 100 });
  });

  it('rejects fixtures that cannot acknowledge their loaded bundle', () => {
    expect(() =>
      prepareArtifacts(fixture('<html><body></body></html>'))
    ).toThrow('missing the macro-bundle-build meta tag');
  });

  it('offers a compatible update once and then reports no update', async () => {
    const artifacts = prepareArtifacts(fixture());
    const handler = createSmokeHandler(artifacts, 'update-101');
    const response = await handler(request(100)).json();
    expect(response).toMatchObject({
      action: 'update',
      bundleBuild: 101,
      minNativeBuild: 0,
      url: 'http://127.0.0.1:3001/artifacts/bundle-101.zip',
      checksum: artifacts.get(101)?.checksum,
    });
    expect(handler(request(101)).status).toBe(204);
  });

  it('switches to revocation only for the applied fixture build', async () => {
    const handler = createSmokeHandler(
      prepareArtifacts(fixture()),
      'no-update'
    );
    expect(handler(request(100)).status).toBe(204);
    handler(
      new Request('http://127.0.0.1:3001/__scenario/revoke-101', {
        method: 'POST',
      })
    );
    expect(await handler(request(101)).json()).toEqual({
      action: 'clear',
      reason: 'bundle_revoked',
    });
    expect(handler(request(100)).status).toBe(204);
  });

  it('suppresses older builds and returns a native upgrade requirement for incompatible builds', async () => {
    const artifacts = prepareArtifacts(fixture());
    expect(createSmokeHandler(artifacts, 'older')(request(100)).status).toBe(
      204
    );
    const handler = createSmokeHandler(artifacts, 'incompatible-102');
    expect(await handler(request(100)).json()).toEqual({
      action: 'native_update_required',
      bundleBuild: 102,
      minNativeBuild: 999999,
    });
    expect(
      handler(new Request('http://127.0.0.1:3001/update/bundle/darwin/aarch64'))
        .status
    ).toBe(400);
  });
});
