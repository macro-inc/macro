import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyAndroidBundle } from './android-bundle';
import { androidPackage, androidReleaseMetadata } from './android-release';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
afterEach(() => vi.mocked(execFileSync).mockReset());

const certificate = 'ab'.repeat(32);
const metadata = androidReleaseMetadata('v2026.10.9', {
  version: '2.5.0',
  bundle: { android: { versionCode: 7 } },
});

function mockBundle(overrides: Record<string, string> = {}, signerStatus = 0) {
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    const parameters = args as string[];
    const key =
      command === 'java'
        ? (parameters.find((arg) => arg.startsWith('--xpath=')) ??
          parameters[2])
        : String(command);
    const outputs: Record<string, string> = {
      jarsigner: 'jar verified.\n',
      keytool: `SHA256: ${certificate}\n`,
      validate: '',
      '--xpath=/manifest/@package': androidPackage,
      '--xpath=/manifest/@android:versionCode': '7',
      '--xpath=/manifest/@android:versionName': '2.5.0',
      dump: '<manifest><application android:debuggable="false" /></manifest>',
      unzip: 'base/lib/arm64-v8a/libapp.so\n',
      ...overrides,
    };
    if (command === 'jarsigner' && signerStatus) {
      throw Object.assign(new Error('jarsigner failed'), {
        status: signerStatus,
        stdout: outputs.jarsigner,
      });
    }
    if (!(key in outputs)) throw new Error(`Unexpected command: ${key}`);
    return outputs[key];
  });
}

function verify() {
  verifyAndroidBundle('app.aab', 'bundletool.jar', certificate, metadata);
}

describe('Android App Bundle verification', () => {
  it('accepts the expected signed ARM64 release', () => {
    mockBundle();
    expect(verify).not.toThrow();
  });

  it('accepts the pinned self-signed upload certificate', () => {
    mockBundle({ jarsigner: 'jar verified, with signer errors.\n' }, 4);
    expect(verify).not.toThrow();
  });

  it.each([1, 16, 20, 32])('rejects jarsigner error status %s', (status) => {
    mockBundle({}, status);
    expect(verify).toThrow(/signature verification/);
  });

  it.each<[string, string, RegExp]>([
    ['jarsigner', 'jar is unsigned.\n', /not signed/],
    ['keytool', `SHA256: ${'cd'.repeat(32)}`, /certificate/],
    ['keytool', `SHA256: ${certificate}\nSHA256: ${certificate}`, /certificate/],
    ['--xpath=/manifest/@package', 'com.wrong.app', /package/],
    ['--xpath=/manifest/@android:versionCode', '6', /versionCode/],
    ['--xpath=/manifest/@android:versionName', '1.0.0', /versionName/],
    ['dump', '<application android:debuggable="true" />', /debuggable/],
    ['unzip', 'base/assets/index.html\n', /ARM64/],
    ['unzip', 'base/lib/x86_64/libapp.so\n', /ARM64/],
    [
      'unzip',
      'base/lib/arm64-v8a/libapp.so\nbase/lib/x86_64/libapp.so\n',
      /ARM64/,
    ],
  ])('rejects incorrect %s output', (key, output, message) => {
    mockBundle({ [key]: output });
    expect(verify).toThrow(message);
  });

  it('stops if bundletool rejects the bundle structure', () => {
    mockBundle();
    const implementation = vi.mocked(execFileSync).getMockImplementation()!;
    vi.mocked(execFileSync).mockImplementation((...args) => {
      if (args[0] === 'java' && args[1]?.includes('validate')) {
        throw new Error('Invalid bundle structure');
      }
      return implementation(...args);
    });
    expect(verify).toThrow('Invalid bundle structure');
  });
});
