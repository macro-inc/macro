import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  androidPackage,
  androidReleaseMetadata,
  bumpAndroidVersionCode,
  ensureAndroidSigning,
  parseAndroidSigning,
  propertyValue,
  provisionAndroidSigning,
  verifyAndroidApk,
} from './android-release';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
afterEach(() => vi.mocked(execFileSync).mockReset());

const keystore = Buffer.from('fake keystore for tests');
const signing = {
  package_name: androidPackage,
  keystore_base64: keystore.toString('base64'),
  keystore_sha256: createHash('sha256').update(keystore).digest('hex'),
  certificate_sha256: 'ab'.repeat(32),
  key_alias: 'upload',
  key_password: 'test-password',
  store_password: 'test-store-password',
};

const releaseConfig = {
  version: '2.5.0',
  bundle: { android: { versionCode: 7 } },
};

describe('Android release versions', () => {
  it.each(['v2026.10.7', 'v2026.10.6.2', 'v2027.1.1.0'])(
    'uses the native config independently of tag %s',
    (tag) => {
      expect(androidReleaseMetadata(tag, releaseConfig)).toEqual({
        version: '2.5.0',
        versionCode: 7,
        filename: `macro-${tag}-android-arm64.apk`,
      });
    }
  );

  it.each([
    'main',
    'v2026.2.29.0',
    'v2026.13.1',
    'v2026.9.28.100',
    'v2100.1.1.0',
    'v2026.9.28.0\n',
  ])('rejects invalid tag %j', (tag) => {
    expect(() => androidReleaseMetadata(tag, releaseConfig)).toThrow();
  });

  it.each([undefined, 0, -1, 1.5, '7', 2_100_000_001])(
    'rejects invalid native build %j',
    (versionCode) => {
      expect(() =>
        androidReleaseMetadata('v2026.10.7', {
          ...releaseConfig,
          bundle: { android: { versionCode } },
        })
      ).toThrow();
    }
  );

  it('increments the native counter without changing the marketing version or platform settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-version-test-'));
    try {
      const path = join(root, 'tauri.android.conf.json');
      const config = {
        ...releaseConfig,
        bundle: {
          android: { versionCode: 7, minSdkVersion: 24 },
          icon: ['icon.png'],
        },
        plugins: { 'deep-link': { mobile: [] } },
      };
      await writeFile(path, JSON.stringify(config));
      expect(await bumpAndroidVersionCode(path)).toBe(8);
      expect(await bumpAndroidVersionCode(path)).toBe(9);
      const updated = JSON.parse(await readFile(path, 'utf8'));
      expect(updated).toEqual({
        ...config,
        bundle: {
          ...config.bundle,
          android: { ...config.bundle.android, versionCode: 9 },
        },
      });
      expect(androidReleaseMetadata('v2026.10.7', updated).versionCode).toBe(9);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not write an exhausted counter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-version-test-'));
    try {
      const path = join(root, 'tauri.android.conf.json');
      const contents = JSON.stringify({
        ...releaseConfig,
        bundle: { android: { versionCode: 2_100_000_000 } },
      });
      await writeFile(path, contents);
      await expect(bumpAndroidVersionCode(path)).rejects.toThrow(
        'Google Play limit'
      );
      expect(await readFile(path, 'utf8')).toBe(contents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Android signing provisioning', () => {
  it('fetches once, preserves configured builds, and reuses signing across worktrees', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-signing-test-'));
    try {
      const directory = join(root, 'private');
      const properties = join(root, 'keystore.properties');
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify(signing));
      await ensureAndroidSigning(directory, properties);
      await ensureAndroidSigning(directory, properties);
      const otherProperties = join(root, 'other.properties');
      await ensureAndroidSigning(directory, otherProperties);
      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(execFileSync).toHaveBeenCalledWith(
        'doppler',
        expect.arrayContaining([
          'ANDROID_UPLOAD_SIGNING_JSON_V2',
          'android-release',
          'prd',
        ]),
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      );
      expect(await readFile(otherProperties, 'utf8')).toBe(
        await readFile(properties, 'utf8')
      );
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(properties)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves explicit configuration without fetching credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-signing-test-'));
    try {
      const properties = join(root, 'keystore.properties');
      await writeFile(properties, 'existing CI signing configuration');
      await ensureAndroidSigning(join(root, 'unused'), properties);
      expect(execFileSync).not.toHaveBeenCalled();
      expect(await readFile(properties, 'utf8')).toBe(
        'existing CI signing configuration'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves broken symlinks and incomplete cached signing without fetching', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-signing-test-'));
    try {
      const directory = join(root, 'private');
      const properties = join(root, 'keystore.properties');
      const missing = join(root, 'missing.properties');
      await symlink(missing, properties);
      await expect(ensureAndroidSigning(directory, properties)).rejects.toThrow(
        /broken symlink/
      );
      expect(await readlink(properties)).toBe(missing);
      await mkdir(directory);
      await expect(
        ensureAndroidSigning(directory, join(root, 'other.properties'))
      ).rejects.toThrow(/incomplete/);
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports missing Doppler access without leaking secrets or leaving files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-signing-test-'));
    try {
      const directory = join(root, 'private');
      const properties = join(root, 'keystore.properties');
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('secret-password');
      });
      await expect(ensureAndroidSigning(directory, properties)).rejects.toThrow(
        'Unable to fetch Android signing credentials. Install the Doppler CLI and authenticate with read access to android-release/prd (CI: DOPPLER_TOKEN). See docs/ANDROID_DEVELOPMENT.md.'
      );
      await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(properties)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed secrets and incorrect keystore checksums without exposing values', () => {
    for (const contents of [
      '{secret-password',
      JSON.stringify({
        ...signing,
        package_name: 'wrong',
        key_password: 'secret-password',
      }),
      JSON.stringify({ ...signing, keystore_sha256: '0'.repeat(64) }),
    ]) {
      expect(() => parseAndroidSigning(contents)).toThrow(
        /Invalid Android|checksum mismatch/
      );
      expect(() => parseAndroidSigning(contents)).not.toThrow(
        /secret-password/
      );
    }
  });

  it('escapes Java properties whitespace, separators, backslashes and Unicode', () => {
    expect(propertyValue(' a\\b\n:=#!é')).toBe(
      '\\u0020a\\u005cb\\u000a\\u003a\\u003d\\u0023\\u0021\\u00e9'
    );
  });

  it('writes private files, links Gradle configuration, and preserves existing files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-signing-test-'));
    try {
      const directory = join(root, 'private');
      const properties = join(root, 'keystore.properties');
      await provisionAndroidSigning(
        JSON.stringify(signing),
        directory,
        properties
      );
      expect(await readFile(join(directory, 'upload-keystore.jks'))).toEqual(
        keystore
      );
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      for (const file of [
        'upload-keystore.jks',
        'keystore.properties',
        'certificate-sha256',
      ]) {
        expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600);
      }
      expect(await readFile(properties, 'utf8')).toContain('keyAlias=upload\n');
      const existing = join(root, 'existing.properties');
      await writeFile(existing, 'keep this');
      await expect(
        provisionAndroidSigning(
          JSON.stringify(signing),
          join(root, 'other'),
          existing
        )
      ).rejects.toThrow();
      expect(await readFile(existing, 'utf8')).toBe('keep this');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('APK verification', () => {
  const metadata = androidReleaseMetadata('v2026.9.28.0', releaseConfig);
  const badging = `package: name='${androidPackage}' versionCode='${metadata.versionCode}' versionName='${metadata.version}' platformBuildVersionName='16'\nnative-code: 'arm64-v8a'\n`;

  function mockTools(
    badge = badging,
    certificate = signing.certificate_sha256
  ) {
    vi.mocked(execFileSync)
      .mockReturnValueOnce(
        `Signer #1 certificate SHA-256 digest: ${certificate}\n`
      )
      .mockReturnValueOnce(Buffer.from(''))
      .mockReturnValueOnce(badge);
  }

  it('accepts the expected signed release', () => {
    mockTools();
    expect(() =>
      verifyAndroidApk(
        'release.apk',
        '/sdk',
        signing.certificate_sha256,
        metadata
      )
    ).not.toThrow();
  });

  it('rejects a different signing certificate', () => {
    mockTools(badging, 'cd'.repeat(32));
    expect(() =>
      verifyAndroidApk(
        'release.apk',
        '/sdk',
        signing.certificate_sha256,
        metadata
      )
    ).toThrow(/certificate/);
  });

  it.each([
    badging.replace(androidPackage, 'com.wrong.app'),
    badging.replace(String(metadata.versionCode), '1'),
    badging.replace(metadata.version, '1.0.0'),
    badging.replace('arm64-v8a', 'x86_64'),
    `${badging}application-debuggable\n`,
  ])('rejects incorrect APK metadata', (badge) => {
    mockTools(badge);
    expect(() =>
      verifyAndroidApk(
        'release.apk',
        '/sdk',
        signing.certificate_sha256,
        metadata
      )
    ).toThrow(/incorrect/);
  });

  it('fails when apksigner fails verification', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('Invalid signature');
    });
    expect(() =>
      verifyAndroidApk(
        'release.apk',
        '/sdk',
        signing.certificate_sha256,
        metadata
      )
    ).toThrow('Invalid signature');
  });
});
