import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(new URL('./ios-app-store.mjs', import.meta.url));
const tree = 'a'.repeat(40);
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

// Preload replaces fetch before the actual CLI runs; no Apple request or real
// credential is used. Unknown endpoints fail immediately instead of networking.
// A release request moves the version on, as App Store Connect does.
const preload = `
let released = false;
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname;
  const state = process.env.TEST_STATE;
  if (state === 'API_ERROR') return new Response('fixture error', { status: 403 });
  let data;
  if (path === '/v1/apps') data = [{ id: 'app' }];
  else if (path === '/v1/apps/app/appStoreVersions') data = state === 'MISSING' ? []
    : [{ id: 'version', attributes: {
      appVersionState: released ? 'PROCESSING_FOR_DISTRIBUTION' : state,
    } }];
  else if (path === '/v1/appStoreVersions/version/build') data = {
    id: 'build', attributes: { version: process.env.TEST_BUILD ?? '188' },
  };
  else if (path === '/v1/builds/build/betaBuildLocalizations') data = [{ attributes: {
    whatsNew: 'native tree ' + process.env.TEST_TREE + ' for PR #123',
  } }];
  else if (path === '/v1/appStoreVersionReleaseRequests' && init?.method === 'POST') {
    released = true;
    data = { id: 'release' };
  }
  else throw new Error('Unexpected endpoint: ' + url);
  return Response.json({ data });
};
`;

function runCli(args, env, { missingGit = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ios-app-store-'));
  try {
    const fixture = path.join(dir, 'fetch.mjs');
    const output = path.join(dir, 'outputs');
    writeFileSync(fixture, preload);
    writeFileSync(output, '');
    const child = spawnSync(process.execPath, [
      '--import', pathToFileURL(fixture).href, script, ...args,
    ], {
      env: {
        ...process.env, GITHUB_OUTPUT: output,
        APPLE_API_KEY: 'fixture', APPLE_API_ISSUER: 'fixture',
        APPLE_API_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        ...env,
        ...(missingGit ? { GIT_DIR: path.join(dir, 'missing.git') } : {}),
      }, encoding: 'utf8', timeout: 10000,
    });
    return { child, outputs: readFileSync(output, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const [state, expected, attachedBuild, stamp, nativeTree = tree] of [
  ['MISSING', 'release-required', '188', tree],
  ['IN_REVIEW', 'waiting', '188', tree],
  ['ACCEPTED', 'waiting', '188', tree],
  ['PENDING_APPLE_RELEASE', 'waiting', '188', tree],
  ['PENDING_DEVELOPER_RELEASE', 'approved', '188', tree],
  ['PROCESSING_FOR_DISTRIBUTION', 'approved', '188', tree],
  ['PENDING_DEVELOPER_RELEASE', 'mismatch', '187', tree],
  ['PENDING_DEVELOPER_RELEASE', 'mismatch', '188', 'b'.repeat(40)],
  ['REJECTED', 'release-required', '188', tree],
  ['REPLACED_WITH_NEW_VERSION', 'mismatch', '188', tree],
  ['READY_FOR_DISTRIBUTION', 'approved', '188', tree],
  ['READY_FOR_DISTRIBUTION', 'mismatch', '187', tree],
  ['READY_FOR_DISTRIBUTION', 'mismatch', '188', 'b'.repeat(40)],
  ['READY_FOR_DISTRIBUTION', null, '188', tree, null],
  ['API_ERROR', null, '188', tree],
]) {
  await test(`status reports ${expected} for ${state}, build ${attachedBuild}, tree ${stamp[0]}`, () => {
    const { child, outputs } = runCli([
      'status', '--require-approved', '--version', '2.0.10', '--build', '188',
      ...(nativeTree ? ['--native-tree', nativeTree] : []),
    ], {
      TEST_STATE: state, TEST_BUILD: attachedBuild, TEST_TREE: stamp,
    }, { missingGit: !nativeTree });
    assert.equal(child.status, expected === 'approved' ? 0 : 1, child.stderr);
    if (!expected) {
      assert.equal(outputs, '', 'failed verification must not emit an App Store conclusion');
      if (!nativeTree) {
        assert.match(child.stderr, /Could not compute.*native tree/);
        assert.doesNotMatch(child.stderr, /bump|ios-update|release again/i);
      }
    } else {
      const result = JSON.parse(outputs.trim().slice('gate_result='.length));
      assert.equal(result.kind, expected);
      assert.equal(result.state, state === 'MISSING' ? null : state);
      assert.equal(result.version, '2.0.10');
      assert.equal(result.build, '188');
      assert.equal(result.floor, JSON.parse(readFileSync(new URL('../min-native-build.json', import.meta.url))).ios);
    }
  });
}

for (const [state, attachedBuild, releases] of [
  ['PENDING_DEVELOPER_RELEASE', '188', true],
  ['PENDING_DEVELOPER_RELEASE', '187', false],
  ['IN_REVIEW', '188', false],
  ['ACCEPTED', '188', false],
  ['READY_FOR_DISTRIBUTION', '188', false],
  ['MISSING', '188', false],
]) {
  await test(`publish ${releases ? 'releases' : 'leaves'} ${state} with build ${attachedBuild}`, () => {
    const { child } = runCli(['publish', '--version', '2.0.10', '--build', '188'], {
      TEST_STATE: state, TEST_BUILD: attachedBuild, TEST_TREE: tree,
    });
    assert.equal(child.status, 0, child.stderr);
    if (releases) {
      assert.match(child.stdout, /Released App Store version 2\.0\.10 \(188\); it is now PROCESSING_FOR_DISTRIBUTION/);
    } else {
      assert.doesNotMatch(child.stdout, /Released/);
    }
  });
}

await test('publish fails when App Store Connect does', () => {
  const { child } = runCli(['publish', '--version', '2.0.10', '--build', '188'], {
    TEST_STATE: 'API_ERROR',
  });
  assert.equal(child.status, 1);
});
