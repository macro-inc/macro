import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest, isNewer, releaseIdentity, tauriReleaseConfig } from './desktop-release.mjs';

describe('desktop releases', () => {
  test('maps calendar tags without losing revision ordering', () => {
    expect(releaseIdentity('refs/tags/v2026.10.6.12')).toEqual({
      tag: 'v2026.10.6.12', version: '2026.1006.12', nativeBuild: 202610060012,
    });
    expect(isNewer('2026.1006.12', '2026.1006.9')).toBe(true);
    expect(isNewer('2026.1007.0', '2026.1006.9999')).toBe(true);
    expect(isNewer('2026.1006.12', '2026.1006.12')).toBe(false);
    expect(isNewer('2.5.0', '2026.1006.12')).toBe(false);
  });

  test('rejects malformed tags and impossible dates', () => {
    for (const tag of ['v2026.2.30.1', 'v2026.13.1.1', 'v1.2.3-beta', 'main', 'v1.2.10000', 'v0.0.0']) {
      expect(() => releaseIdentity(tag)).toThrow();
    }
  });

  const directories: string[] = [];
  afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); });

  test('requires both signed platform artifacts with the packaged version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macro-desktop-release-'));
    directories.push(dir);
    const tag = 'v2026.10.6.1';
    const identity = releaseIdentity(tag);
    for (const [target, suffix] of [['darwin-aarch64', 'aarch64-darwin.app.tar.gz'], ['linux-x86_64', 'x86_64-linux.AppImage']]) {
      const name = `Macro-${identity.version}-${suffix}`;
      writeFileSync(join(dir, name), 'artifact');
      writeFileSync(join(dir, `${name}.sig`), 'signature');
      writeFileSync(join(dir, `${target}.release.json`), JSON.stringify({ ...identity, enabled: true }));
    }
    const manifest = createManifest(dir, tag, 'macro-inc/macro', '14.0');
    expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64', 'linux-x86_64']);
    expect(manifest.platforms['darwin-aarch64'].url).toContain('/v2026.10.6.1/Macro-2026.1006.1-');
    expect(manifest.platforms['darwin-aarch64'].minimumSystemVersion).toBe('14.0');
    expect(manifest.platforms['linux-x86_64']).not.toHaveProperty('minimumSystemVersion');
    for (const minimum of [undefined, '', '13', '13.x']) {
      expect(() => createManifest(dir, tag, 'macro-inc/macro', minimum)).toThrow();
    }
    rmSync(join(dir, 'Macro-2026.1006.1-x86_64-linux.AppImage.sig'));
    expect(() => createManifest(dir, tag, 'macro-inc/macro', '14.0')).toThrow();
  });

  test('adds Windows only when its build was released', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macro-desktop-release-'));
    directories.push(dir);
    const tag = 'v2026.10.6.1';
    const identity = releaseIdentity(tag);
    const write = (target: string, suffix: string) => {
      const name = `Macro-${identity.version}-${suffix}`;
      writeFileSync(join(dir, name), 'artifact');
      writeFileSync(join(dir, `${name}.sig`), 'signature');
      writeFileSync(join(dir, `${target}.release.json`), JSON.stringify({ ...identity, enabled: true }));
    };
    write('darwin-aarch64', 'aarch64-darwin.app.tar.gz');
    write('linux-x86_64', 'x86_64-linux.AppImage');
    expect(Object.keys(createManifest(dir, tag, 'macro-inc/macro', '14.0').platforms)).toEqual(['darwin-aarch64', 'linux-x86_64']);
    write('windows-x86_64', 'x86_64-windows-setup.exe');
    const manifest = createManifest(dir, tag, 'macro-inc/macro', '14.0');
    expect(manifest.platforms['windows-x86_64'].url).toBe(
      'https://github.com/macro-inc/macro/releases/download/v2026.10.6.1/Macro-2026.1006.1-x86_64-windows-setup.exe',
    );
    // Its metadata without the signed installer is a broken release, not an absent one.
    rmSync(join(dir, 'Macro-2026.1006.1-x86_64-windows-setup.exe.sig'));
    expect(() => createManifest(dir, tag, 'macro-inc/macro', '14.0')).toThrow();
  });

  test('builds the Tauri release config from the release identity', () => {
    expect(tauriReleaseConfig({
      version: '2026.1006.1', nativeBuild: 202610060001, enabled: true,
      endpoint: 'https://example.test/latest.json', publicKey: 'key',
    })).toEqual({
      version: '2026.1006.1',
      build: { beforeBuildCommand: '' },
      bundle: { externalBin: ['binaries/macrod'] },
      plugins: {
        'desktop-update': { enabled: true },
        'macro-bundle-updater': { nativeBuild: 202610060001 },
        updater: { pubkey: 'key', endpoints: ['https://example.test/latest.json'] },
      },
    });
  });
});
