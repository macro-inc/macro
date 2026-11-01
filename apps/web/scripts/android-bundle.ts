import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { androidPackage, androidReleaseMetadata } from './android-release';

const javaLocale = ['-J-Duser.language=en', '-J-Duser.country=US'];

export function verifyAndroidBundle(
  bundle: string,
  bundletool: string,
  expectedCertificate: string,
  metadata: ReturnType<typeof androidReleaseMetadata>
) {
  let verification: string;
  try {
    verification = execFileSync(
      'jarsigner',
      [...javaLocale, '-verify', '-strict', bundle],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (error) {
    // Android upload certificates are self-signed. jarsigner's bit 4 includes
    // untrusted chains; accept ONLY that status and pin the certificate below.
    // In particular, bit 16 (unsigned entries) must always fail.
    if (
      typeof error !== 'object' ||
      error === null ||
      !('status' in error) ||
      error.status !== 4 ||
      !('stdout' in error) ||
      typeof error.stdout !== 'string'
    ) {
      throw new Error('AAB signature verification failed');
    }
    verification = error.stdout;
  }
  if (!/^jar verified[.,\s]/m.test(verification)) {
    throw new Error('AAB is not signed');
  }
  const certificates = execFileSync(
    'keytool',
    [...javaLocale, '-printcert', '-jarfile', bundle],
    { encoding: 'utf8' }
  );
  const fingerprints = [
    ...certificates.matchAll(/SHA256:\s*([a-fA-F0-9:]+)/g),
  ].map((match) => match[1].replaceAll(':', '').toLowerCase());
  if (
    fingerprints.length !== 1 ||
    fingerprints[0] !== expectedCertificate.trim().toLowerCase()
  ) {
    throw new Error('AAB does not have the expected upload certificate');
  }

  const runBundletool = (...args: string[]) =>
    execFileSync('java', ['-jar', bundletool, ...args, `--bundle=${bundle}`], {
      encoding: 'utf8',
    }).trim();
  runBundletool('validate');
  for (const [attribute, expected] of [
    ['package', androidPackage],
    ['android:versionCode', String(metadata.versionCode)],
    ['android:versionName', metadata.version],
  ]) {
    const actual = runBundletool(
      'dump',
      'manifest',
      '--module=base',
      `--xpath=/manifest/@${attribute}`
    );
    if (actual !== expected) {
      throw new Error(`AAB ${attribute} is incorrect`);
    }
  }
  const manifest = runBundletool('dump', 'manifest', '--module=base');
  if (/android:debuggable="true"/.test(manifest)) {
    throw new Error('AAB is debuggable');
  }
  const entries = execFileSync('unzip', ['-Z1', bundle], { encoding: 'utf8' });
  const abis = new Set(
    [...entries.matchAll(/^[^/]+\/lib\/([^/]+)\/[^\n]+\.so$/gm)].map(
      (match) => match[1]
    )
  );
  if (abis.size !== 1 || !abis.has('arm64-v8a')) {
    throw new Error('AAB must contain only ARM64 native libraries');
  }
}

if (import.meta.main) {
  const [tag, bundle, bundletool, certificateFile, ...extra] =
    process.argv.slice(2);
  try {
    if (!tag || !bundle || !bundletool || !certificateFile || extra.length) {
      throw new Error(
        'Usage: android-bundle.ts TAG AAB BUNDLETOOL_JAR CERTIFICATE_FILE'
      );
    }
    const config = JSON.parse(
      await readFile(
        new URL('../tauri/src-tauri/tauri.android.conf.json', import.meta.url),
        'utf8'
      )
    );
    verifyAndroidBundle(
      bundle,
      bundletool,
      await readFile(certificateFile, 'utf8'),
      androidReleaseMetadata(tag, config)
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid AAB');
    process.exitCode = 1;
  }
}
