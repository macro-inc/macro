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
const preload = `
globalThis.fetch = async (url) => {
  const path = new URL(url).pathname;
  const state = process.env.TEST_STATE;
  if (state === 'API_ERROR') return new Response('fixture error', { status: 403 });
  let data;
  if (path === '/v1/apps') data = [{ id: 'app' }];
  else if (path === '/v1/apps/app/appStoreVersions') data = state === 'MISSING' ? []
    : [{ id: 'version', attributes: { appVersionState: state } }];
  else if (path === '/v1/appStoreVersions/version/build') data = {
    id: 'build', attributes: { version: process.env.TEST_BUILD ?? '188' },
  };
  else if (path === '/v1/builds/build/betaBuildLocalizations') data = [{ attributes: {
    whatsNew: 'native tree ' + process.env.TEST_TREE + ' for PR #123',
  } }];
  else throw new Error('Unexpected endpoint: ' + url);
  return Response.json({ data });
};
`;

for (const [state, expected, attachedBuild, stamp] of [
  ['MISSING', 'release-required', '188', tree],
  ['IN_REVIEW', 'waiting', '188', tree],
  ['PENDING_DEVELOPER_RELEASE', 'waiting', '188', tree],
  ['REJECTED', 'release-required', '188', tree],
  ['REPLACED_WITH_NEW_VERSION', 'mismatch', '188', tree],
  ['READY_FOR_DISTRIBUTION', 'live', '188', tree],
  ['READY_FOR_DISTRIBUTION', 'mismatch', '187', tree],
  ['READY_FOR_DISTRIBUTION', 'mismatch', '188', 'b'.repeat(40)],
  ['API_ERROR', null, '188', tree],
]) {
  test(`status reports ${expected} for ${state}, build ${attachedBuild}, tree ${stamp[0]}`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ios-gate-status-'));
    try {
      const fixture = path.join(dir, 'fetch.mjs');
      const output = path.join(dir, 'outputs');
      writeFileSync(fixture, preload);
      writeFileSync(output, '');
      const child = spawnSync(process.execPath, [
        '--import', pathToFileURL(fixture).href, script, 'status', '--require-live',
        '--version', '2.0.10', '--build', '188', '--native-tree', tree,
      ], {
        env: {
          ...process.env, GITHUB_OUTPUT: output,
          APPLE_API_KEY: 'fixture', APPLE_API_ISSUER: 'fixture',
          APPLE_API_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }),
          TEST_STATE: state, TEST_BUILD: attachedBuild, TEST_TREE: stamp,
        }, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(child.status, expected === 'live' ? 0 : 1, child.stderr);
      const text = readFileSync(output, 'utf8');
      if (!expected) {
        assert.equal(text, '', 'an API failure must not emit an App Store conclusion');
      } else {
        const result = JSON.parse(text.trim().slice('gate_result='.length));
        assert.equal(result.kind, expected);
        assert.equal(result.version, '2.0.10');
        assert.equal(result.build, '188');
        assert.equal(result.floor, JSON.parse(readFileSync(new URL('../min-native-build.json', import.meta.url))).ios);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
