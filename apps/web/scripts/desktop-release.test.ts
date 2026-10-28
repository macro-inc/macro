import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest, isNewer, releaseIdentity } from './desktop-release.mjs';

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
    const manifest = createManifest(dir, tag, 'macro-inc/macro');
    expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64', 'linux-x86_64']);
    expect(manifest.platforms['darwin-aarch64'].url).toContain('/v2026.10.6.1/Macro-2026.1006.1-');
    rmSync(join(dir, 'Macro-2026.1006.1-x86_64-linux.AppImage.sig'));
    expect(() => createManifest(dir, tag, 'macro-inc/macro')).toThrow();
  });
});
