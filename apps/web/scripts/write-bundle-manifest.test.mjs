import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function build(env) {
  const dir = mkdtempSync(join(tmpdir(), 'macro-manifest-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'dist'));
    copyFileSync(new URL('./write-bundle-manifest.mjs', import.meta.url), join(dir, 'scripts/build.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"version":"2.5.0"}');
    writeFileSync(join(dir, 'dist/index.html'), '__MACRO_BUNDLE_BUILD__');
    execFileSync(process.execPath, [join(dir, 'scripts/build.mjs')], { env: { PATH: process.env.PATH, BUNDLE_BUILD_NUMBER: '20', ...env }, stdio: 'pipe' });
    return JSON.parse(readFileSync(join(dir, 'dist/bundle-manifest.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('independent mobile minima use a schema older updaters reject', () => {
  const manifest = build({ MIN_NATIVE_BUILD_ANDROID: '2050001', MIN_NATIVE_BUILD_IOS: '184' });
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(manifest.minNativeBuilds, { android: 2050001, ios: 184 });
});
test('incomplete or unsafe minima fail the build', () => {
  assert.throws(() => build({ MIN_NATIVE_BUILD_ANDROID: '2' }));
  assert.throws(() => build({ MIN_NATIVE_BUILD_ANDROID: '9007199254740992', MIN_NATIVE_BUILD_IOS: '1' }));
});
test('legacy manifests retain schema 2', () => {
  assert.equal(build({ MIN_NATIVE_BUILD: '5' }).schemaVersion, 2);
});
