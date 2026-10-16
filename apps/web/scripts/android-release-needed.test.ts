import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { androidReleaseDecision } from './android-release-needed.mjs';
import { checkAndroidVersion } from './android-version-check.mjs';

const nativeConfig = 'apps/web/tauri/src-tauri/tauri.android.conf.json';
let cwd: string;

function git(...args: string[]) {
  return execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
}

function write(path: string, contents: string) {
  const file = join(cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function version(code: number) {
  write(
    nativeConfig,
    JSON.stringify({ bundle: { android: { versionCode: code } } })
  );
}

function commit() {
  git('add', '.');
  git('commit', '--allow-empty', '-m', 'test release');
}

function release(tag = 'v2026.10.1') {
  git('tag', tag);
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: ['.aab', '.aab.sha256', '-mapping.txt', '-mapping.txt.sha256'].map(
      (suffix) => ({
        name: `macro-${tag}-android-arm64${suffix}`,
        size: 100,
        state: 'uploaded',
      })
    ),
  };
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'android-release-needed-'));
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.com');
  version(1);
  write('apps/web/tauri/src-tauri/src/lib.rs', '// native');
  commit();
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe('PR Android version enforcement', () => {
  it('passes frontend-only and backend-only changes without a bump', () => {
    const base = git('rev-parse', 'HEAD');
    write('apps/web/src/index.tsx', '// frontend');
    write('services/example/src/lib.rs', '// backend');
    commit();
    expect(checkAndroidVersion({ cwd, base })).toContain('No Android native changes');
  });

  it.each(['modify', 'add', 'delete', 'rename'])(
    'rejects a native %s without a bump',
    (change) => {
      const base = git('rev-parse', 'HEAD');
      const path = 'apps/web/tauri/src-tauri/src/lib.rs';
      if (change === 'modify') write(path, '// changed');
      if (change === 'add') write('apps/web/tauri/src-tauri/new-file', 'new');
      if (change === 'delete') rmSync(join(cwd, path));
      if (change === 'rename') git('mv', path, `${path}.renamed`);
      commit();
      expect(() => checkAndroidVersion({ cwd, base })).toThrow(
        /just android-bump/
      );
    }
  );

  it('accepts native changes with a higher version code', () => {
    const base = git('rev-parse', 'HEAD');
    write('apps/web/tauri/src-tauri/src/lib.rs', '// changed');
    version(2);
    commit();
    expect(checkAndroidVersion({ cwd, base })).toContain('from 1 to 2');
  });

  it.each([0, 1.5, 2_100_000_001])(
    'rejects invalid version code %s',
    (code) => {
      const base = git('rev-parse', 'HEAD');
      version(code);
      commit();
      expect(() => checkAndroidVersion({ cwd, base })).toThrow(
        /Invalid Android versionCode/
      );
    }
  );

  it('rejects a version downgrade', () => {
    version(3);
    commit();
    const base = git('rev-parse', 'HEAD');
    version(2);
    commit();
    expect(() => checkAndroidVersion({ cwd, base })).toThrow(/must exceed/);
  });

  it('rejects two PRs trying to use the same version code', () => {
    git('checkout', '-b', 'pr');
    version(2);
    write('apps/web/tauri/first-native-change', 'PR change');
    commit();
    git('checkout', 'main');
    version(2);
    write('apps/web/tauri/second-native-change', 'Already merged');
    commit();
    const base = git('rev-parse', 'HEAD');
    git('merge', '--no-ff', 'pr', '-m', 'PR merge result');
    expect(() => checkAndroidVersion({ cwd, base })).toThrow(
      /base branch \(2\)/
    );
  });

  it('does not attribute newer base-branch native changes to a frontend-only PR', () => {
    git('checkout', '-b', 'pr');
    write('apps/web/src/index.tsx', '// frontend');
    commit();
    git('checkout', 'main');
    version(2);
    commit();
    const base = git('rev-parse', 'HEAD');
    git('merge', '--no-ff', 'pr', '-m', 'PR merge result');
    expect(checkAndroidVersion({ cwd, base })).toContain('No Android native changes');
  });

  it.each([
    'apps/web/tauri/src-tauri/gen/apple/project.yml',
    'apps/web/tauri/src-tauri/Info.ios.plist',
    'apps/web/tauri/callkit_plugin/ios/Sources/CallKitPlugin.swift',
    'apps/web/tauri/src-tauri/icons/macos/Macro.icon/icon.json',
    'apps/web/tauri/src-tauri/tauri.macos.conf.json',
    'apps/web/tauri/src-tauri/src/linux_notification.rs',
    'apps/web/tauri/desktop-release.json',
  ])('ignores the iOS/desktop-only path %s', (path) => {
    const base = git('rev-parse', 'HEAD');
    write(path, 'changed');
    commit();
    expect(checkAndroidVersion({ cwd, base })).toContain(
      'No Android native changes'
    );
  });

  it('requires a bump when the client cache wasm version moves', () => {
    write(
      'crates/client/cache-wasm/Cargo.toml',
      '[package]\nname = "cache-wasm"\nversion = "0.6.1"\n'
    );
    commit();
    const base = git('rev-parse', 'HEAD');
    write(
      'crates/client/cache-wasm/Cargo.toml',
      '[package]\nname = "cache-wasm"\nversion = "0.6.2"\n'
    );
    write('crates/client/cache-core/src/lib.rs', '// cache change');
    commit();
    expect(() => checkAndroidVersion({ cwd, base })).toThrow(
      /cache wasm version moved \(0\.6\.1 → 0\.6\.2\).*just android-bump/
    );
    version(2);
    commit();
    expect(checkAndroidVersion({ cwd, base })).toContain('from 1 to 2');
  });

  it('does not require a bump for client cache edits without a version bump', () => {
    write(
      'crates/client/cache-wasm/Cargo.toml',
      '[package]\nname = "cache-wasm"\nversion = "0.6.1"\n'
    );
    commit();
    const base = git('rev-parse', 'HEAD');
    write('crates/client/cache-core/src/lib.rs', '// cache change');
    write('crates/client/cache-wasm/Cargo.toml', '[package]\nname = "cache-wasm"\nversion = "0.6.1"\n[dependencies]\nx = "1"\n');
    commit();
    expect(checkAndroidVersion({ cwd, base })).toContain(
      'No Android native changes'
    );
  });

  it('fails closed if the base commit is unavailable', () => {
    expect(() => checkAndroidVersion({ cwd, base: 'missing-base' })).toThrow();
  });
});

describe('native release detection', () => {
  it('builds the first AAB when no complete ancestor bundle exists', () => {
    expect(androidReleaseDecision({ cwd, releases: [] }).build).toBe(true);
  });

  it('skips frontend, backend, workflow, and root dependency changes', () => {
    const baseline = release();
    for (const path of [
      'apps/web/src/index.tsx',
      'services/example/src/lib.rs',
      '.github/workflows/release-production.yml',
      'Cargo.lock',
      'apps/web/scripts/android.sh',
    ]) {
      write(path, 'changed');
    }
    commit();
    expect(androidReleaseDecision({ cwd, releases: [baseline] }).build).toBe(
      false
    );
  });

  it.each([
    'apps/web/tauri/src-tauri/src/lib.rs',
    'apps/web/tauri/src-tauri/gen/android/app/build.gradle.kts',
    'apps/web/tauri/src-tauri/gen/apple/project.yml',
  ])('builds for changes under %s with a new version code', (path) => {
    const baseline = release();
    write(path, 'changed');
    version(2);
    commit();
    expect(androidReleaseDecision({ cwd, releases: [baseline] }).build).toBe(
      true
    );
  });

  it.each([1, 0])('rejects native changes with version code %s', (code) => {
    const baseline = release();
    write('apps/web/tauri/src-tauri/src/lib.rs', '// changed');
    version(code);
    commit();
    expect(() => androidReleaseDecision({ cwd, releases: [baseline] })).toThrow(
      /versionCode/
    );
  });

  const cacheWasm = (version: string, extra = '') =>
    write(
      'crates/client/cache-wasm/Cargo.toml',
      `[package]\nname = "cache-wasm"\nversion = "${version}"\n${extra}`
    );

  it('builds when the client cache wasm version moves, with a new version code', () => {
    cacheWasm('0.6.1');
    commit();
    const baseline = release();
    cacheWasm('0.6.2');
    write('crates/client/cache-core/src/lib.rs', '// cache change');
    version(2);
    commit();
    expect(androidReleaseDecision({ cwd, releases: [baseline] })).toEqual({
      build: true,
      summary: expect.stringContaining(
        'the client cache wasm version moved (0.6.1 → 0.6.2) since v2026.10.1'
      ),
    });
  });

  it('rejects a client cache wasm version bump without a new version code', () => {
    cacheWasm('0.6.1');
    commit();
    const baseline = release();
    cacheWasm('0.6.2');
    commit();
    expect(() => androidReleaseDecision({ cwd, releases: [baseline] })).toThrow(
      /versionCode/
    );
  });

  it('skips client cache changes that do not move the wasm version', () => {
    cacheWasm('0.6.1');
    commit();
    const baseline = release();
    cacheWasm('0.6.1', '[dependencies]\nserde = "1"\n');
    write('crates/client/cache-core/src/lib.rs', '// cache change');
    write('crates/client/cache-turso/src/lib.rs', '// storage change');
    commit();
    expect(androidReleaseDecision({ cwd, releases: [baseline] }).build).toBe(
      false
    );
  });

  it('detects deleted native files', () => {
    const baseline = release();
    rmSync(join(cwd, 'apps/web/tauri/src-tauri/src/lib.rs'));
    version(2);
    commit();
    expect(androidReleaseDecision({ cwd, releases: [baseline] }).build).toBe(
      true
    );
  });

  it('skips net-zero native changes', () => {
    const baseline = release();
    write('apps/web/tauri/src-tauri/src/lib.rs', '// temporary');
    commit();
    write('apps/web/tauri/src-tauri/src/lib.rs', '// native');
    commit();
    expect(androidReleaseDecision({ cwd, releases: [baseline] }).build).toBe(
      false
    );
  });

  it('uses the closest ancestor regardless of API release ordering', () => {
    const old = release();
    version(2);
    commit();
    const latest = release('v2026.10.2');
    write('apps/web/src/index.tsx', '// frontend');
    commit();
    expect(androidReleaseDecision({ cwd, releases: [old, latest] })).toEqual({
      build: false,
      summary: expect.stringContaining('v2026.10.2'),
    });
  });

  it.each(['missing', 'empty', 'uploading', 'draft', 'prerelease'])(
    'does not lose changes after a release with %s artifacts',
    (state) => {
      const baseline = release();
      version(2);
      commit();
      const failed = release('v2026.10.2');
      if (state === 'missing') failed.assets.pop();
      if (state === 'empty') failed.assets[0].size = 0;
      if (state === 'uploading') failed.assets[0].state = 'starter';
      if (state === 'draft') failed.draft = true;
      if (state === 'prerelease') failed.prerelease = true;
      write('apps/web/src/index.tsx', '// frontend');
      commit();
      expect(
        androidReleaseDecision({ cwd, releases: [failed, baseline] })
      ).toEqual({
        build: true,
        summary: expect.stringContaining('v2026.10.1'),
      });
    }
  );

  it('ignores bundles on an unrelated branch and future releases', () => {
    const baseline = release();
    git('checkout', '-b', 'other');
    version(3);
    commit();
    const unrelated = release('v2026.10.3');
    git('checkout', 'main');
    version(2);
    commit();
    const current = git('rev-parse', 'HEAD');
    version(3);
    commit();
    const future = release('v2026.10.4');
    git('checkout', '--detach', current);
    expect(
      androidReleaseDecision({ cwd, releases: [future, unrelated, baseline] })
    ).toEqual({ build: true, summary: expect.stringContaining('v2026.10.1') });
  });

  it('skips a rerun after this release already published complete artifacts', () => {
    const current = release();
    expect(androidReleaseDecision({ cwd, releases: [current] }).build).toBe(
      false
    );
  });

  it('supports annotated release tags', () => {
    const baseline = release();
    git('tag', '-d', baseline.tag_name);
    git('tag', '-a', baseline.tag_name, '-m', 'release');
    expect(androidReleaseDecision({ cwd, releases: [baseline] }).build).toBe(
      false
    );
  });

  it('fails when a published bundle tag is absent from checkout history', () => {
    const baseline = release();
    git('tag', '-d', baseline.tag_name);
    expect(() =>
      androidReleaseDecision({ cwd, releases: [baseline] })
    ).toThrow();
  });
});
