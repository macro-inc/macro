import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  androidPackage,
  androidReleaseMetadata,
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

describe('Android release versions', () => {
  it('assigns deterministic increasing codes across revisions, days, and years', () => {
    const tags = [
      'v2026.9.28.0',
      'v2026.9.28.99',
      'v2026.9.29.0',
      'v2027.1.1.0',
    ];
    const codes = tags.map((tag) => androidReleaseMetadata(tag).versionCode);
    expect(codes).toEqual([2026092800, 2026092899, 2026092900, 2027010100]);
    expect(androidReleaseMetadata(tags[0])).toEqual({
      version: '2026.9.28-0',
      versionCode: 2026092800,
      filename: 'macro-v2026.9.28.0-android-arm64.apk',
    });
    expect(androidReleaseMetadata('v2099.12.31.99').versionCode).toBeLessThan(
      2100000000
    );
  });

  it.each([
    'main',
    'v2026.2.29.0',
    'v2026.13.1.0',
    'v2026.9.28.100',
    'v2100.1.1.0',
    'v2026.9.28.0\n',
  ])('rejects invalid tag %j', (tag) => {
    expect(() => androidReleaseMetadata(tag)).toThrow();
  });
});

describe('Android signing provisioning', () => {
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
  const metadata = androidReleaseMetadata('v2026.9.28.0');
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
