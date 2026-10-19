import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { version } from '../package.json';
import { bundleProblems } from './verify-tauri-bundle';
import { wasmPackages } from './wasm-packages';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});

const otelUrl = 'https://macro-prox-prod.macroverse.workers.dev/i/otlp/v1/traces';

function dist(options: {
  commit: string;
  omit?: string;
  inlined?: string;
  omitOtelUrl?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'macro-tauri-bundle-'));
  directories.push(dir);
  mkdirSync(join(dir, 'assets'));
  for (const { name } of wasmPackages) {
    if (name === options.omit) continue;
    writeFileSync(join(dir, 'assets', `${name}-Dx1a2b3c.js`), '');
    writeFileSync(join(dir, 'assets', `${name}_bg-Ab4c5d6e.wasm`), '');
  }
  writeFileSync(join(dir, 'semver.txt'), `${version}+${options.commit}\n`);
  writeFileSync(
    join(dir, 'bundle-manifest.json'),
    JSON.stringify({ gitSha: options.commit, appVersion: version })
  );
  writeFileSync(
    join(dir, 'index-Q1w2e3r4.js'),
    `console.log("App Version ","${version}+${options.inlined ?? options.commit}");` +
      `const t=${options.omitOtelUrl ? 'void 0' : `"${otelUrl}"`},e="prod";` +
      'const p="phc_public";'
  );
  return dir;
}

it('accepts a bundle with every WASM package, the build env and the commit', () => {
  expect(
    bundleProblems(dist({ commit: '170584f' }), 'production', {
      VITE_POSTHOG_API_KEY: 'phc_public',
    })
  ).toEqual([]);
});

it('rejects a bundle missing the agent fold WASM, as Nix built it', () => {
  expect(
    bundleProblems(dist({ commit: '170584f', omit: 'agent_fold' }), 'production', {})
  ).toEqual([
    'missing agent_fold.js: build the WASM packages first (just build-wasm)',
    'missing agent_fold_bg.wasm: build the WASM packages first (just build-wasm)',
  ]);
});

it('rejects a bundle built without the telemetry exporter URL, as Nix built it', () => {
  expect(
    bundleProblems(dist({ commit: '170584f', omitOtelUrl: true }), 'production', {})
  ).toEqual([`no script inlines VITE_OTEL_EXPORTER_URL "${otelUrl}"`]);
});

it('expects an exporter URL from the environment in place of the default', () => {
  expect(
    bundleProblems(dist({ commit: '170584f' }), 'production', {
      VITE_OTEL_EXPORTER_URL: 'https://otel.example/v1/traces',
    })
  ).toEqual([
    'no script inlines VITE_OTEL_EXPORTER_URL "https://otel.example/v1/traces"',
  ]);
});

it('rejects a supplied PostHog key that did not reach the bundle', () => {
  expect(
    bundleProblems(dist({ commit: '170584f' }), 'production', {
      VITE_POSTHOG_API_KEY: 'phc_other',
    })
  ).toEqual(['VITE_POSTHOG_API_KEY was set but no script inlines it']);
});

it('rejects a version that does not name a commit', () => {
  expect(bundleProblems(dist({ commit: 'unknown' }), 'production', {})).toEqual([
    `semver.txt is "${version}+unknown", expected ${version}+<commit>; set MACRO_GIT_SHA where the build has no git checkout`,
  ]);
});

it('rejects a bundle whose scripts inline a different version', () => {
  expect(
    bundleProblems(dist({ commit: '170584f', inlined: 'unknown' }), 'production', {})
  ).toEqual([`no script inlines the app version ${version}+170584f`]);
});
